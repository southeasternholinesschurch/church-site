/**
 * The Monday digest — gathering the week. The pure half, including the text, is
 * digest.ts; this only asks the database the questions it needs answered.
 *
 * Built fresh every time, for the page and for the text alike, so the two can
 * never disagree and there is nothing stored to go stale.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../db';
import { KIDS_KIND_IDS, kindLabel } from './services';
import { addDays, dayOf, guestName, parseWants, wantsText } from './care';
import { dueCounts, openQueue, refreshMissing, getCareSettings, reachableRecipients, type QueueItem } from './care-db';
import { rosterDays } from './singing-db';
import {
  celebrationsBetween, comingSunday, digestKey, digestText, reportWeek,
  type Celebration, type DigestData, type ServiceCount,
} from './digest';
import { parseHhmm, GRACE_MINUTES, type LocalNow } from './schedules';

type Env = { DB: D1Database; REMINDER_SHEET_CSV_URL?: string };

export interface DigestPage extends DigestData {
  today: string;
  sunday: string;
  queue: QueueItem[];
  guests: { id: number; name: string; when: string; what: string }[];
  expectedList: { id: number; name: string; date: string | null; party: string | null }[];
  sheets: { id: number; title: string; open: number; date: string | null }[];
  celebrations: Celebration[];
}

export async function buildDigest(env: Env, today: string): Promise<DigestPage> {
  const db = getDb(env);
  const week = reportWeek(today);
  const sunday = comingSunday(today);
  const kids = sql.join(KIDS_KIND_IDS.map((k) => sql`${k}`), sql`, `);

  /* ---- last week's attendance, and the eight weeks before it ----------- */
  const headcount = sql`(SELECT count(*) FROM attendance a WHERE a.service_id = s.id)
                      + (SELECT count(*) FROM visitors v WHERE v.service_id = s.id)`;
  const held = await db.all<{ kind: string; date: string; total: number }>(sql`
    SELECT s.kind, s.date, ${headcount} AS total FROM services s
    WHERE s.kind NOT IN (${kids}) AND s.date >= ${week.start} AND s.date <= ${week.end}
    ORDER BY s.date
  `);
  const before = await db.all<{ kind: string; average: number }>(sql`
    SELECT kind, round(avg(total)) AS average FROM (
      SELECT s.kind AS kind, ${headcount} AS total FROM services s
      WHERE s.kind NOT IN (${kids})
        AND s.date >= ${addDays(week.start, -56)} AND s.date < ${week.start}
    ) WHERE total > 0 GROUP BY kind
  `);
  const avg = new Map(before.map((b) => [b.kind, Number(b.average)]));
  // Most recent first, and within a day in the order the day runs — so the
  // text reads "Sun AM, Sun PM, Wed", which is how a pastor says it.
  const ORDER = ['sunday-morning', 'sunday-school', 'sunday-evening', 'wednesday', 'other'];
  const services: ServiceCount[] = held
    // A service started on the register and never taken is not a service with
    // nobody at it.
    .filter((s) => Number(s.total) > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
    .map((s) => ({ kind: s.kind, label: kindLabel(s.kind), date: s.date,
                   total: Number(s.total), average: avg.get(s.kind) ?? null }));

  /* ---- the follow-up list ----------------------------------------------- */
  await refreshMissing(env, today);
  const care = await dueCounts(env, today);
  const queue = (await openQueue(env, today)).now;

  /* ---- guests: who came, and who is coming ------------------------------- */
  const cards = await db.select().from(schema.guestCards)
    .where(sql`${schema.guestCards.createdAt} >= ${addDays(week.start, -1)}`);
  const guests = cards
    .filter((c) => c.kind === 'here' && dayOf(c.createdAt) >= week.start && dayOf(c.createdAt) <= week.end)
    .map((c) => ({ id: c.id, name: guestName(c), when: dayOf(c.createdAt),
                   what: [c.firstTime ? 'first time' : '', wantsText(parseWants(c.wants))]
                     .filter(Boolean).join(' · ') }));
  const planned = await db.select().from(schema.guestCards)
    .where(and(eq(schema.guestCards.kind, 'planning'),
               sql`${schema.guestCards.visitDate} >= ${today}`,
               sql`${schema.guestCards.visitDate} <= ${addDays(today, 6)}`));
  const expectedList = planned.map((c) => ({ id: c.id, name: guestName(c), date: c.visitDate, party: c.party }));

  /* ---- the week's birthdays and anniversaries ---------------------------- */
  // Everyone on the list, not the bulletin's consent rule: this is the pastors'
  // own summary, read by the people who already see the People page.
  const people = await db.select({
    id: schema.people.id, firstName: schema.people.firstName, lastName: schema.people.lastName,
    birthday: schema.people.birthday, anniversary: schema.people.anniversary,
    adultChild: schema.people.adultChild,
  }).from(schema.people)
    .where(and(eq(schema.people.archived, false),
               sql`(${schema.people.birthday} IS NOT NULL OR ${schema.people.anniversary} IS NOT NULL)`));
  const celebrations = celebrationsBetween(people.map((p) => ({
    personId: p.id, name: `${p.firstName} ${p.lastName}`.trim(), birthday: p.birthday,
    // An anniversary on a child's record is a data-entry slip, not a wedding.
    anniversary: p.adultChild === 'child' ? null : p.anniversary,
  })), today);

  /* ---- singing on the coming Sunday -------------------------------------- */
  const days = await rosterDays(env);
  const day = days?.find((d) => d.sunday === sunday);
  const cell = (label: string) => {
    const s = day?.slots.find((x) => x.label === label);
    return s ? (s.note ?? s.names.join(', ')) : null;
  };
  const singing = day ? { sunday, morning: cell('Morning'), evening: cell('Evening') } : null;

  /* ---- sign-up sheets still wanting people this week --------------------- */
  const slots = await db.all<{ sheetId: number; title: string; date: string | null; cap: number; taken: number }>(sql`
    SELECT sh.id AS sheetId, sh.title AS title, coalesce(sl.on_date, sh.event_date) AS date,
      sl.capacity AS cap, (SELECT count(*) FROM signups su WHERE su.slot_id = sl.id) AS taken
    FROM signup_slots sl JOIN signup_sheets sh ON sh.id = sl.sheet_id
    WHERE sh.status = 'open' AND sl.capacity IS NOT NULL
      AND coalesce(sl.on_date, sh.event_date) >= ${today}
      AND coalesce(sl.on_date, sh.event_date) <= ${addDays(today, 6)}
  `);
  const bySheet = new Map<number, { id: number; title: string; open: number; date: string | null }>();
  for (const s of slots) {
    if (Number(s.taken) >= Number(s.cap)) continue;
    const e = bySheet.get(s.sheetId) ?? { id: s.sheetId, title: s.title, open: 0, date: s.date };
    e.open++;
    if (s.date && (!e.date || s.date < e.date)) e.date = s.date;
    bySheet.set(s.sheetId, e);
  }
  const sheets = [...bySheet.values()];

  return {
    today, sunday, week, services,
    care: { guest: care.guest, missing: care.missing, reminder: care.reminder },
    newGuests: guests.length, expected: expectedList.length,
    celebrations, singing,
    openSlots: sheets.reduce((n, s) => n + s.open, 0),
    queue, guests, expectedList, sheets,
  };
}

/**
 * Monday morning's text, queued for each pastor who should have it.
 *
 * The same shape as the birthday texts: a standing arrangement read from
 * settings, due inside a window after the chosen time, and safe to run on every
 * five-minute tick — the unique key per person per Monday is what stops a
 * second text, not any check here. The digest is only BUILT when somebody is
 * still owed one, so the window's other eleven ticks cost one small query.
 */
export async function expandDigest(env: Env, local: LocalNow, origin: string):
  Promise<{ queued: number; detail: string } | null> {
  const settings = await getCareSettings(env);
  if (!settings.digestOn || local.weekday !== 1) return null;
  const at = parseHhmm(settings.digestTime);
  if (at === null || local.minutes < at || local.minutes > at + GRACE_MINUTES) return null;

  const recipients = await reachableRecipients(env, settings.recipientIds);
  if (!recipients.length) return null;

  const db = getDb(env);
  const keys = recipients.map((r) => digestKey(local.date, r.personId));
  const sent = new Set((await db.select({ k: schema.scheduledMessages.sourceKey })
    .from(schema.scheduledMessages).where(inArray(schema.scheduledMessages.sourceKey, keys)))
    .map((r) => r.k));
  const owed = recipients.filter((r) => !sent.has(digestKey(local.date, r.personId)));
  if (!owed.length) return null;

  const body = digestText(await buildDigest(env, local.date), `${origin}/digest`);
  let queued = 0;
  for (const r of owed) {
    const ins = await db.insert(schema.scheduledMessages).values({
      sourceKey: digestKey(local.date, r.personId),
      // 'schedule', because that is what drainQueue sends.
      source: 'schedule', personId: r.personId, phoneE164: r.phoneE164,
      body, sendAt: nowIso(), status: 'pending', createdAt: nowIso(),
    }).onConflictDoNothing().returning({ id: schema.scheduledMessages.id });
    if (ins[0]) queued++;
  }
  return { queued, detail: `Monday digest: ${queued} queued` };
}
