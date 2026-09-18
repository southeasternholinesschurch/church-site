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
import { and, eq, inArray, lte, ne, sql } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../db';
import { buildAudience } from './recipients';
import { sendOne, smsConfigured, countSegments, type SmsEnv } from './sms';
import { dueOn, hasBirthdayOn, localNow, parseHhmm, queueKey, renderBody,
         GRACE_MINUTES, type ScheduleRow } from './schedules';
import { getBirthdaySettings } from './birthday-settings';
import { consentByNumbers } from './consent';
import { firstNameOf, reminderBodyFor, reminderDue, reminderKey, reminderMissed,
         renderReminder, shortWhen } from './signups';

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

  // --- "you are bringing a meal tomorrow" ---------------------------------
  // Same shape again: a standing arrangement, not a rule anybody creates.
  const sq = await expandSignupReminders(env, local);
  if (sq) { queued += sq.queued; schedules++; detail.push(sq.detail); }

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

/**
 * Sign-up reminders: "you signed up to bring a meal tomorrow."
 *
 * Fires at 09:00 church time the day BEFORE the day somebody claimed, and stays
 * sendable until 09:00 on the day itself. Both halves of that window live in
 * reminderDue() in lib/signups.ts, which is pure and tested with an injected
 * clock — this function does the reading and writing and decides nothing.
 *
 * `source_key` is `signup:{id}`. A sign-up is for exactly ONE slot on ONE date,
 * so its id is already a stable occurrence identity and no date needs to ride
 * along the way it does for a weekly rule. The UNIQUE index on
 * scheduled_messages.source_key is the ONLY thing preventing a second text —
 * not the loop, not any check below — which is what makes this safe to run on
 * every five-minute tick.
 *
 * A MISSED reminder writes a `skipped` row rather than nothing. It takes the
 * same key, so the row that records the miss is also what stops a late text
 * going out on the next tick. A silent non-send is worse than a visible one.
 */
async function expandSignupReminders(env: Env, local: ReturnType<typeof localNow>) {
  const db = getDb(env);

  /*
   * Bounded to yesterday, today and tomorrow.
   *
   * The window is at most two days wide, so those three dates are every row
   * that could possibly be due — and without the bound this query would grow
   * without limit, re-reading every meal train the church has ever run on every
   * tick. Yesterday is in the list only so that a full day of cron outage still
   * leaves a visible `skipped` row instead of nothing at all.
   *
   * The date a sign-up is FOR is the slot's own day when it has one (a meal
   * train), and otherwise the event's date (a dish sheet, a dated list).
   */
  const when = sql`coalesce(${schema.signupSlots.onDate}, ${schema.signupSheets.eventDate})`;
  const window = [
    new Date(Date.parse(`${local.date}T12:00:00Z`) - 86400_000).toISOString().slice(0, 10),
    local.date,
    new Date(Date.parse(`${local.date}T12:00:00Z`) + 86400_000).toISOString().slice(0, 10),
  ];

  const rows = await db.select({
    id: schema.signups.id,
    name: schema.signups.name,
    personId: schema.signups.personId,
    ownPhone: schema.signups.phoneE164,
    ownConsent: schema.signups.smsConsent,
    onDate: schema.signupSlots.onDate,
    eventDate: schema.signupSheets.eventDate,
    reminderBody: schema.signupSheets.reminderBody,
    memberPhone: schema.people.phoneE164,
    memberConsent: schema.people.smsConsent,
    memberArchived: schema.people.archived,
  }).from(schema.signups)
    .innerJoin(schema.signupSlots, eq(schema.signups.slotId, schema.signupSlots.id))
    .innerJoin(schema.signupSheets, eq(schema.signups.sheetId, schema.signupSheets.id))
    // A member's number is resolved through `people` rather than copied onto
    // the sign-up: they already consented once, nothing new is stored, and a
    // member who changes their number is reached at the new one.
    .leftJoin(schema.people, eq(schema.signups.personId, schema.people.id))
    .where(and(
      eq(schema.signups.remind, true),
      // A draft sheet is not public, so nothing should have signed up to one —
      // but staff can add somebody by hand, and a draft must not text anyone.
      ne(schema.signupSheets.status, 'draft'),
      inArray(when, window),
    ));

  if (!rows.length) return null;

  /*
   * CONSENT IS MATCHED BY NUMBER, NEVER BY PERSON — the rule lib/consent.ts
   * exists to enforce, applied here at the moment of queueing rather than
   * trusted from whatever was recorded when somebody filled the form in. A
   * number that texted STOP last week must not be reached today because a row
   * from last month still says opted_in.
   *
   * One query per table for the whole batch, not one per sign-up.
   */
  // The row's OWN number wins over the member's on-file one. A recognised
  // member who was not already opted in types a number like anybody else, and
  // that is the number they asked to be reached at.
  const numberFor = (r: { ownPhone: string | null; memberPhone: string | null }) =>
    r.ownPhone ?? r.memberPhone;
  const numbers = [...new Set(rows.map(numberFor).filter((n): n is string => !!n))];
  const decision = await consentByNumbers(db, numbers);

  let queued = 0, skipped = 0;
  for (const r of rows) {
    const date = r.onDate ?? r.eventDate;
    const due = reminderDue(date, local);
    const missed = !due && reminderMissed(date, local);
    if (!due && !missed) continue;

    const phone = numberFor(r);
    // An archived member is not texted, the same rule every other audience
    // follows. Their sign-up still stands on the sheet.
    const allowed = Boolean(phone) && decision.get(phone!) === 'opted_in'
      && !(r.personId && r.memberArchived);

    const body = renderReminder(reminderBodyFor(r.reminderBody), {
      first: firstNameOf(r.name),
      when: shortWhen(date ?? ''),
    });

    const note = missed
      ? 'Reminder window passed before this could be sent'
      : 'No consent to text this number at reminder time';

    const ins = await db.insert(schema.scheduledMessages).values({
      sourceKey: reminderKey(r.id),
      // 'schedule', because that is what drainQueue sends. A different source
      // here would queue a row that nothing ever picks up.
      source: 'schedule',
      personId: r.personId,
      phoneE164: phone ?? null,
      body,
      sendAt: nowIso(),
      status: due && allowed ? 'pending' : 'skipped',
      sentAt: due && allowed ? null : nowIso(),
      note: due && allowed ? null : note,
      createdAt: nowIso(),
    }).onConflictDoNothing().returning({ id: schema.scheduledMessages.id });

    if (!ins[0]) continue;                 // already queued, sent or skipped
    if (due && allowed) queued++; else skipped++;
  }

  if (!queued && !skipped) return null;
  return {
    queued,
    detail: `Sign-up reminders: ${queued} queued`
          + (skipped ? `, ${skipped} skipped` : ''),
  };
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
