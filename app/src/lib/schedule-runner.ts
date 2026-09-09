/**
 * Turning schedules into sent texts.
 *
 * Two steps, deliberately separate:
 *
 *   expandDue  — a rule that is due becomes one queue row per recipient
 *   drainQueue — queued rows are actually sent, a bounded number per run
 *
 * They are separate because they fail differently. Expansion is cheap, safe to
 * repeat, and must re-read the audience every time (that is what makes
 * birthdays dynamic). Sending spends money, is not safely repeatable, and is
 * capped by a hard platform limit. Keeping them apart means a slow or partial
 * send never loses the record of who was supposed to get it.
 */
import { and, eq, inArray, lte } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../db';
import { buildAudience } from './recipients';
import { sendOne, smsConfigured, countSegments, type SmsEnv } from './sms';
import { dueOn, hasBirthdayOn, localNow, parseHhmm, queueKey, renderBody,
         GRACE_MINUTES, type ScheduleRow } from './schedules';
import { getBirthdaySettings } from './birthday-settings';

/**
 * Twilio sends per cron run.
 *
 * A Workers request may make 50 outbound fetches; the 51st fails. This is not
 * theoretical — a 75-person broadcast once sent 51 and silently dropped the
 * rest, which is the bug that made anyone look at this code at all. 40 is the
 * same ceiling /api/sms/send settled on, with headroom for retries.
 *
 * The remainder is not lost: it stays pending and the next run picks it up, so
 * a large audience drains over consecutive ticks rather than failing at 51.
 */
export const SENDS_PER_RUN = 40;

type Env = SmsEnv & { DB: D1Database };

export interface ExpandResult { queued: number; schedules: number; detail: string[] }

/** Rules that are due right now become queue rows, one per recipient. */
export async function expandDue(env: Env, now = new Date()): Promise<ExpandResult> {
  const db = getDb(env);
  const local = localNow(now);
  const rows = await db.select().from(schema.messageSchedules)
    .where(eq(schema.messageSchedules.active, true));

  const detail: string[] = [];
  let queued = 0, schedules = 0;

  for (const raw of rows) {
    const s: ScheduleRow = {
      id: raw.id, name: raw.name, body: raw.body, kind: raw.kind,
      groupId: raw.groupId, recipientIds: parseRecipientIds(raw.recipientIds),
      sendAt: raw.sendAt, weekday: raw.weekday,
      localTime: raw.localTime, active: raw.active, lastRunAt: raw.lastRunAt,
    };
    const occurrence = dueOn(s, local);
    if (!occurrence) continue;
    schedules++;

    const targets = s.recipientIds?.length
      ? await namedTargets(env, s.recipientIds)
      : await groupTargets(env, s.groupId);

    let added = 0;
    for (const t of targets) {
      // onConflictDoNothing against the unique source_key is the ONLY thing
      // preventing a duplicate text. Not the loop, not a prior check — the
      // database. That is why expansion may safely run every five minutes.
      const ins = await db.insert(schema.scheduledMessages).values({
        sourceKey: queueKey(s.id, occurrence, t.personId),
        source: 'schedule',
        scheduleId: s.id,
        personId: t.personId,
        phoneE164: t.phoneE164,
        body: renderBody(s.body, t),
        groupId: s.groupId,
        sendAt: nowIso(),
        status: 'pending',
        createdAt: nowIso(),
      }).onConflictDoNothing().returning({ id: schema.scheduledMessages.id });
      if (ins[0]) added++;
    }

    queued += added;
    detail.push(`${s.name}: ${added} queued (${targets.length} in audience)`);

    // Informational only — the list shows it as "last ran". Written on every
    // pass through the window, so it reflects the most recent re-read.
    await db.update(schema.messageSchedules)
      .set({ lastRunAt: occurrence })
      .where(eq(schema.messageSchedules.id, s.id));
  }

  // --- automatic birthday texts -------------------------------------------
  // Not a schedule and never was one on this screen: a standing arrangement
  // that runs every day the switch is on, with nothing for anyone to create.
  const bq = await expandBirthdays(env, local);
  if (bq) { queued += bq.queued; schedules++; detail.push(bq.detail); }

  return { queued, schedules, detail };
}

/** Stored as JSON text; a corrupt value means "no named recipients", never a crash. */
function parseRecipientIds(raw: string | null): number[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return null;
    const ids = v.map(Number).filter((n) => Number.isInteger(n) && n > 0);
    return ids.length ? ids : null;
  } catch { return null; }
}

/**
 * Today's birthdays, if the switch is on and we are inside the window.
 *
 * Re-read on every tick like everything else, which is the point: a birthday
 * typed into the directory at 9:20 is caught by the 9:25 tick. The unique
 * source_key is what stops the re-read becoming a second text.
 */
async function expandBirthdays(env: Env, local: ReturnType<typeof localNow>) {
  const settings = await getBirthdaySettings(env);
  if (!settings.on) return null;
  const at = parseHhmm(settings.time);
  if (at === null) return null;
  if (local.minutes < at || local.minutes > at + GRACE_MINUTES) return null;

  const db = getDb(env);
  const targets = await birthdayTargets(env, local.date);
  let queued = 0;
  for (const t of targets) {
    const ins = await db.insert(schema.scheduledMessages).values({
      sourceKey: `bday:${local.date}:${t.personId}`,
      source: 'schedule',
      personId: t.personId,
      phoneE164: t.phoneE164,
      body: renderBody(settings.body, t),
      sendAt: nowIso(),
      status: 'pending',
      createdAt: nowIso(),
    }).onConflictDoNothing().returning({ id: schema.scheduledMessages.id });
    if (ins[0]) queued++;
  }
  return { queued, detail: `Birthdays: ${queued} queued (${targets.length} today)` };
}

interface Target { personId: number; phoneE164: string; firstName: string; lastName: string }

/**
 * Everyone whose birthday is today.
 *
 * Read fresh from the directory on every call — nothing is cached or
 * precomputed — so a birthday typed in this morning is found this morning.
 * Month and day are compared in JS rather than in SQL, because the stored value
 * is a plain 'YYYY-MM-DD' string and putting it through a date function would
 * reintroduce the UTC-midnight-is-yesterday bug the bulletin already had.
 */
async function birthdayTargets(env: Env, occurrence: string): Promise<Target[]> {
  const db = getDb(env);
  const rows = await db.select({
    id: schema.people.id, firstName: schema.people.firstName, lastName: schema.people.lastName,
    phoneE164: schema.people.phoneE164, smsConsent: schema.people.smsConsent,
    birthday: schema.people.birthday,
  }).from(schema.people).where(eq(schema.people.archived, false));

  const out: Target[] = [];
  for (const r of rows) {
    if (!hasBirthdayOn(r.birthday, occurrence)) continue;
    // Consent is checked here exactly as buildAudience checks it. A birthday is
    // not a reason to text someone who has opted out.
    if (!r.phoneE164 || r.smsConsent !== 'opted_in') continue;
    out.push({ personId: r.id, phoneE164: r.phoneE164, firstName: r.firstName, lastName: r.lastName });
  }
  return out;
}

/**
 * Named individuals.
 *
 * Consent is checked here exactly as buildAudience checks it. Choosing someone
 * by name is not an override: an opt-out still means opt-out, and the schedule
 * simply reaches fewer people than it names.
 */
async function namedTargets(env: Env, ids: number[]): Promise<Target[]> {
  const db = getDb(env);
  const rows = await db.select({
    id: schema.people.id, firstName: schema.people.firstName, lastName: schema.people.lastName,
    phoneE164: schema.people.phoneE164, smsConsent: schema.people.smsConsent,
  }).from(schema.people)
    .where(and(eq(schema.people.archived, false), inArray(schema.people.id, ids)));

  const seen = new Set<string>();
  const out: Target[] = [];
  for (const r of rows) {
    if (!r.phoneE164 || r.smsConsent !== 'opted_in') continue;
    // One text per handset, the same rule groups follow — naming a couple who
    // share a phone must not text that phone twice.
    if (seen.has(r.phoneE164)) continue;
    seen.add(r.phoneE164);
    out.push({ personId: r.id, phoneE164: r.phoneE164, firstName: r.firstName, lastName: r.lastName });
  }
  return out;
}

/** A group's audience, or everyone when groupId is null. */
async function groupTargets(env: Env, groupId: number | null): Promise<Target[]> {
  const audience = await buildAudience(env, groupId);
  // One row per HANDSET, not per person: a couple sharing a phone gets one
  // text, the same rule the manual sender already follows.
  return audience.handsets.map((h) => {
    const p = h.people[0];
    const [firstName, ...rest] = p.name.split(' ');
    return { personId: p.personId, phoneE164: h.phoneE164, firstName, lastName: rest.join(' ') };
  });
}

export interface DrainResult { sent: number; failed: number; remaining: number; errors: string[] }

/** Send what is queued and due, up to the per-run ceiling. */
export async function drainQueue(env: Env, limit = SENDS_PER_RUN): Promise<DrainResult> {
  const db = getDb(env);
  if (!smsConfigured(env)) return { sent: 0, failed: 0, remaining: 0, errors: ['Twilio not configured'] };

  const due = await db.select().from(schema.scheduledMessages)
    .where(and(
      eq(schema.scheduledMessages.status, 'pending'),
      eq(schema.scheduledMessages.source, 'schedule'),
      lte(schema.scheduledMessages.sendAt, nowIso()),
    ))
    .orderBy(schema.scheduledMessages.sendAt)
    .limit(limit + 1);

  const batch = due.slice(0, limit);
  const remaining = Math.max(0, due.length - batch.length);
  const errors: string[] = [];
  let sent = 0, failed = 0;

  for (const row of batch) {
    if (!row.phoneE164) {
      await db.update(schema.scheduledMessages)
        .set({ status: 'skipped', sentAt: nowIso(), note: 'No usable number at send time' })
        .where(eq(schema.scheduledMessages.id, row.id));
      continue;
    }

    // Mark it sending BEFORE the send. If this Worker dies mid-flight the row
    // reads 'failed' and a human looks at it — which is recoverable. Leaving it
    // 'pending' would have the next run text the same person again, and texting
    // someone twice is the one outcome there is no undo for.
    const claim = await db.update(schema.scheduledMessages)
      .set({ status: 'failed', note: 'Send interrupted — check before retrying' })
      .where(and(eq(schema.scheduledMessages.id, row.id),
                 eq(schema.scheduledMessages.status, 'pending')))
      .returning({ id: schema.scheduledMessages.id });
    if (!claim[0]) continue;                       // another run already has it

    const result = await sendOne(env, row.phoneE164, row.body);
    const { segments } = countSegments(row.body);

    await db.insert(schema.messageLog).values({
      personId: row.personId, phoneE164: row.phoneE164, body: row.body,
      direction: 'out', twilioSid: result.sid ?? null,
      status: result.ok ? (result.status ?? 'queued') : 'failed',
      errorCode: result.errorCode ?? null, segments,
      scheduledMessageId: row.id, createdAt: nowIso(),
    });

    await db.update(schema.scheduledMessages)
      .set({ status: result.ok ? 'sent' : 'failed', sentAt: nowIso(),
             note: result.ok ? null : (result.error ?? result.errorCode ?? 'failed') })
      .where(eq(schema.scheduledMessages.id, row.id));

    if (result.ok) sent++;
    else { failed++; errors.push(`${row.phoneE164}: ${result.error ?? result.errorCode}`); }
  }

  return { sent, failed, remaining, errors };
}
