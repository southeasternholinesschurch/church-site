/**
 * Pastoral care — the half that reads and writes. Everything that DECIDES is in
 * care.ts and is tested there; this file asks the database and does what it
 * was told.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../db';
import { KIDS_KIND_IDS } from './services';
import {
  addDays, churchDate, dayOf, findMissing, guestAlertBody, guestKey, guestName, guestReason,
  missingKey, missingReason, parseIdList, parseMissingKey, shortDate, sortQueue,
  DEFAULT_DIGEST_TIME, MISSING_PRIOR_WEEKS, MISSING_RECENT_WEEKS,
  type CareSettings, type GuestDraft,
} from './care';
import { parseHhmm } from './schedules';
import { consentByNumbers } from './consent';

type Env = { DB: D1Database };

/** Who is doing it — enough to sign a note, nothing more. */
export interface Actor { id: number; name: string | null; email: string }

const actorId = (a: Actor) => (a.id > 0 ? a.id : null);
const actorName = (a: Actor) => a.name ?? a.email;

/* ------------------------------------------- regulars who have stopped -- */

/**
 * Bring the list up to date with attendance: add anyone who has stopped coming,
 * and close the item of anyone who has come back.
 *
 * Run when someone LOOKS — on /care, /digest and the Monday digest text — rather
 * than on a schedule, because the answer only changes when attendance is taken,
 * and recomputing is two queries. It is safe to run any number of times: the
 * unique source_key means an absence is listed once, however often this runs.
 */
export async function refreshMissing(env: Env, today: string = churchDate()):
  Promise<{ added: number; closed: number }> {
  const db = getDb(env);
  const kids = sql.join(KIDS_KIND_IDS.map((k) => sql`${k}`), sql`, `);

  // Half a year back is far more than twelve weeks of services need, and still
  // finds twelve if the church took a summer off from taking attendance.
  const services = await db.all<{ date: string }>(sql`
    SELECT DISTINCT s.date AS date FROM services s
    WHERE s.kind NOT IN (${kids})
      AND s.date <= ${today} AND s.date >= ${addDays(today, -26 * 7)}
      AND EXISTS (SELECT 1 FROM attendance a WHERE a.service_id = s.id)
  `);
  const dates = services.map((s) => s.date);
  if (!dates.length) return { added: 0, closed: 0 };

  // Only the weeks the rule reads. The cut-off is the earliest date that falls
  // in the oldest of those weeks, so no presence the rule needs is left out.
  const windowWeeks = MISSING_RECENT_WEEKS + MISSING_PRIOR_WEEKS;
  const weekStarts = [...new Set(dates.map((d) => {
    const day = new Date(`${d}T12:00:00Z`).getUTCDay();
    return addDays(d, -day);
  }))].sort().reverse().slice(0, windowWeeks);
  const cutoff = weekStarts[weekStarts.length - 1]!;

  const presence = await db.all<{ personId: number; date: string }>(sql`
    SELECT a.person_id AS personId, s.date AS date
    FROM attendance a
    JOIN services s ON s.id = a.service_id
    JOIN people p ON p.id = a.person_id
    WHERE s.kind NOT IN (${kids}) AND s.date >= ${cutoff} AND s.date <= ${today}
      AND p.archived = 0
  `);

  const missing = findMissing(dates.filter((d) => d >= cutoff), presence);
  // Only the ones not already listed. The unique key would refuse the others
  // anyway; asking first means opening the page is a read, not a write per
  // absent regular every time.
  const keys = missing.map((m) => missingKey(m.personId, m.lastSeen));
  const known = new Set<string>();
  for (let i = 0; i < keys.length; i += 90) {
    const rows = await db.select({ k: schema.careItems.sourceKey }).from(schema.careItems)
      .where(inArray(schema.careItems.sourceKey, keys.slice(i, i + 90)));
    for (const r of rows) if (r.k) known.add(r.k);
  }
  let added = 0;
  for (const m of missing) {
    if (known.has(missingKey(m.personId, m.lastSeen))) continue;
    const ins = await db.insert(schema.careItems).values({
      personId: m.personId, kind: 'missing', reason: missingReason(m),
      dueOn: today, sourceKey: missingKey(m.personId, m.lastSeen),
      status: 'open', createdBy: 'attendance', createdAt: nowIso(),
    }).onConflictDoNothing().returning({ id: schema.careItems.id });
    if (ins[0]) added++;
  }

  /*
   * Close the ones who have come back.
   *
   * A missing item whose person has attended SINCE the date in its key is
   * answered — not by a pastor, by them walking in. Closed with the date, so
   * the list says "Back Sun, Oct 12" rather than an item quietly vanishing. And
   * an archived person is not somebody to chase.
   */
  const open = await db.select({
    id: schema.careItems.id, sourceKey: schema.careItems.sourceKey,
    personId: schema.careItems.personId, archived: schema.people.archived,
  }).from(schema.careItems)
    .leftJoin(schema.people, eq(schema.careItems.personId, schema.people.id))
    .where(and(eq(schema.careItems.status, 'open'), eq(schema.careItems.kind, 'missing')));

  const latest = new Map<number, string>();
  for (const p of presence) {
    if (!latest.has(p.personId) || p.date > latest.get(p.personId)!) latest.set(p.personId, p.date);
  }

  let closed = 0;
  for (const item of open) {
    const key = parseMissingKey(item.sourceKey);
    let resolution: string | null = null;
    if (item.archived) resolution = 'Archived';
    else if (key) {
      const back = latest.get(key.personId);
      if (back && back > key.lastSeen) resolution = `Back ${shortDate(back)}`;
    }
    if (!resolution) continue;
    await db.update(schema.careItems)
      .set({ status: 'done', resolution, resolvedAt: nowIso(), resolvedBy: 'attendance' })
      .where(and(eq(schema.careItems.id, item.id), eq(schema.careItems.status, 'open')));
    closed++;
  }
  return { added, closed };
}

/* ------------------------------------------------------------ the list -- */

export interface QueueItem {
  id: number;
  kind: 'missing' | 'guest' | 'reminder';
  reason: string;
  dueOn: string;
  createdAt: string;
  createdBy: string | null;
  personId: number | null;
  guestId: number | null;
  name: string;
  phone: string | null;
  email: string | null;
  assignedStaffId: number | null;
  assignedName: string | null;
  /** The newest note about this person or guest, for the one-line "last". */
  last: { kind: string; onDate: string; body: string | null; author: string | null } | null;
  /** The card's own words, for a guest. */
  message: string | null;
}

/** Every open item, split into what needs doing now and what is coming up. */
export async function openQueue(env: Env, today: string = churchDate()):
  Promise<{ now: QueueItem[]; later: QueueItem[] }> {
  const db = getDb(env);
  const rows = await db.all<{
    id: number; kind: QueueItem['kind']; reason: string; dueOn: string; createdAt: string;
    createdBy: string | null; personId: number | null; guestId: number | null;
    pFirst: string | null; pLast: string | null; pPhone: string | null; pEmail: string | null;
    gFirst: string | null; gLast: string | null; gPhone: string | null; gEmail: string | null;
    gMessage: string | null; assignedStaffId: number | null; assignedName: string | null;
    assignedEmail: string | null;
  }>(sql`
    SELECT ci.id, ci.kind, ci.reason, ci.due_on AS dueOn, ci.created_at AS createdAt,
      ci.created_by AS createdBy, ci.person_id AS personId, ci.guest_id AS guestId,
      p.first_name AS pFirst, p.last_name AS pLast, p.phone AS pPhone, p.email AS pEmail,
      g.first_name AS gFirst, g.last_name AS gLast, g.phone AS gPhone, g.email AS gEmail,
      g.message AS gMessage,
      ci.assigned_staff_id AS assignedStaffId, st.name AS assignedName, st.email AS assignedEmail
    FROM care_items ci
    LEFT JOIN people p ON p.id = ci.person_id
    LEFT JOIN guest_cards g ON g.id = ci.guest_id
    LEFT JOIN staff st ON st.id = ci.assigned_staff_id
    WHERE ci.status = 'open'
  `);

  const lastNotes = await latestNotes(env);
  const items: QueueItem[] = rows.map((r) => ({
    id: r.id, kind: r.kind, reason: r.reason, dueOn: r.dueOn, createdAt: r.createdAt,
    createdBy: r.createdBy, personId: r.personId, guestId: r.guestId,
    // A guest who has since been added to People is shown by their People
    // name, which is the one a pastor may have corrected.
    name: r.pFirst ? `${r.pFirst} ${r.pLast ?? ''}`.trim()
        : guestName({ firstName: r.gFirst ?? 'Guest', lastName: r.gLast }),
    phone: r.pPhone ?? r.gPhone, email: r.pEmail ?? r.gEmail,
    assignedStaffId: r.assignedStaffId,
    assignedName: r.assignedStaffId ? (r.assignedName ?? r.assignedEmail) : null,
    last: (r.personId ? lastNotes.person.get(r.personId) : undefined)
       ?? (r.guestId ? lastNotes.guest.get(r.guestId) : undefined) ?? null,
    message: r.gMessage,
  }));

  const sorted = sortQueue(items);
  return {
    now: sorted.filter((i) => i.dueOn <= today),
    later: sorted.filter((i) => i.dueOn > today).sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
  };
}

/** The newest note per person and per guest. One query, whatever the size of
 *  the list — a lookup per item would be a query per row. */
async function latestNotes(env: Env) {
  const db = getDb(env);
  const rows = await db.all<{
    personId: number | null; guestId: number | null; kind: string; onDate: string;
    body: string | null; author: string | null;
  }>(sql`
    SELECT person_id AS personId, guest_id AS guestId, kind, on_date AS onDate, body,
      author_name AS author
    FROM (
      SELECT cn.*, row_number() OVER (
        PARTITION BY coalesce(cn.person_id, -cn.guest_id)
        ORDER BY cn.on_date DESC, cn.id DESC) AS rn
      FROM care_notes cn
    ) WHERE rn = 1
  `);
  const person = new Map<number, QueueItem['last']>();
  const guest = new Map<number, QueueItem['last']>();
  for (const r of rows) {
    const v = { kind: r.kind, onDate: r.onDate, body: r.body, author: r.author };
    if (r.personId) person.set(r.personId, v);
    else if (r.guestId) guest.set(r.guestId, v);
  }
  return { person, guest };
}

/** How many need looking at today — the dashboard notice and the digest. */
export async function dueCounts(env: Env, today: string = churchDate()):
  Promise<{ guest: number; missing: number; reminder: number; total: number }> {
  const db = getDb(env);
  const rows = await db.all<{ kind: string; n: number }>(sql`
    SELECT kind, count(*) AS n FROM care_items
    WHERE status = 'open' AND due_on <= ${today} GROUP BY kind
  `);
  const get = (k: string) => Number(rows.find((r) => r.kind === k)?.n ?? 0);
  const out = { guest: get('guest'), missing: get('missing'), reminder: get('reminder'), total: 0 };
  out.total = out.guest + out.missing + out.reminder;
  return out;
}

/* ------------------------------------------------------------- writing -- */

export interface ContactInput {
  personId: number | null;
  guestId: number | null;
  kind: string;
  onDate: string;
  body: string | null;
}

export async function addNote(env: Env, n: ContactInput, by: Actor): Promise<void> {
  if (!n.personId && !n.guestId) return;
  await getDb(env).insert(schema.careNotes).values({
    personId: n.personId, guestId: n.guestId, kind: n.kind, body: n.body,
    onDate: n.onDate, staffId: actorId(by), authorName: actorName(by), createdAt: nowIso(),
  });
}

/** Close one item. Only ever an OPEN item, so replaying the form is harmless. */
export async function closeItem(env: Env, id: number, resolution: string, by: Actor): Promise<void> {
  await getDb(env).update(schema.careItems)
    .set({ status: 'done', resolution: resolution.slice(0, 200), resolvedAt: nowIso(),
           resolvedBy: actorName(by) })
    .where(and(eq(schema.careItems.id, id), eq(schema.careItems.status, 'open')));
}

export async function addReminder(
  env: Env, who: { personId: number | null; guestId: number | null },
  dueOn: string, reason: string, by: Actor,
): Promise<void> {
  if (!who.personId && !who.guestId) return;
  await getDb(env).insert(schema.careItems).values({
    personId: who.personId, guestId: who.guestId, kind: 'reminder',
    reason: reason.slice(0, 200) || 'Check in', dueOn, status: 'open',
    // Whoever sets a reminder is the obvious person to have it.
    assignedStaffId: actorId(by), createdBy: actorName(by), createdAt: nowIso(),
  });
}

export async function snoozeItem(env: Env, id: number, until: string): Promise<void> {
  await getDb(env).update(schema.careItems).set({ dueOn: until })
    .where(and(eq(schema.careItems.id, id), eq(schema.careItems.status, 'open')));
}

export async function assignItem(env: Env, id: number, staffId: number | null): Promise<void> {
  await getDb(env).update(schema.careItems).set({ assignedStaffId: staffId })
    .where(eq(schema.careItems.id, id));
}

export async function itemById(env: Env, id: number) {
  const rows = await getDb(env).select().from(schema.careItems)
    .where(eq(schema.careItems.id, id)).limit(1);
  return rows[0] ?? null;
}

/** The staff who can see this list — the only sensible people to assign to. */
export async function careStaff(env: Env): Promise<{ id: number; name: string }[]> {
  const rows = await getDb(env).select({ id: schema.staff.id, name: schema.staff.name,
    email: schema.staff.email }).from(schema.staff)
    .where(and(eq(schema.staff.active, true), eq(schema.staff.role, 'admin')));
  return rows.map((r) => ({ id: r.id, name: r.name ?? r.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------------------------------------- reading -- */

export interface NoteRow {
  id: number; kind: string; body: string | null; onDate: string;
  authorName: string | null; staffId: number | null; createdAt: string;
  personId: number | null; guestId: number | null; who?: string;
}

/** Everything written about one person — including what was written about them
 *  as a guest, before they were added to People. */
export async function notesFor(env: Env, who: { personId?: number; guestId?: number }): Promise<NoteRow[]> {
  const db = getDb(env);
  const cond = who.personId ? eq(schema.careNotes.personId, who.personId)
             : who.guestId ? eq(schema.careNotes.guestId, who.guestId) : null;
  if (!cond) return [];
  return db.select().from(schema.careNotes).where(cond)
    .orderBy(desc(schema.careNotes.onDate), desc(schema.careNotes.id));
}

export async function itemsFor(env: Env, who: { personId?: number; guestId?: number }) {
  const db = getDb(env);
  const cond = who.personId ? eq(schema.careItems.personId, who.personId)
             : who.guestId ? eq(schema.careItems.guestId, who.guestId) : null;
  if (!cond) return [];
  return db.select().from(schema.careItems).where(cond)
    .orderBy(desc(schema.careItems.createdAt));
}

/** The most recent notes by anybody — so two pastors can see what the other did. */
export async function recentNotes(env: Env, limit = 25): Promise<NoteRow[]> {
  const rows = await getDb(env).all<NoteRow & { pFirst: string | null; pLast: string | null;
    gFirst: string | null; gLast: string | null }>(sql`
    SELECT cn.id, cn.kind, cn.body, cn.on_date AS onDate, cn.author_name AS authorName,
      cn.staff_id AS staffId, cn.created_at AS createdAt, cn.person_id AS personId,
      cn.guest_id AS guestId,
      p.first_name AS pFirst, p.last_name AS pLast, g.first_name AS gFirst, g.last_name AS gLast
    FROM care_notes cn
    LEFT JOIN people p ON p.id = cn.person_id
    LEFT JOIN guest_cards g ON g.id = cn.guest_id
    ORDER BY cn.created_at DESC, cn.id DESC
    LIMIT ${limit}
  `);
  return rows.map((r) => ({
    ...r,
    who: r.pFirst ? `${r.pFirst} ${r.pLast ?? ''}`.trim()
       : guestName({ firstName: r.gFirst ?? 'Guest', lastName: r.gLast }),
  }));
}

/**
 * When somebody was last at a service, and how many of the last twelve weeks
 * they came. Read beside a person's notes because "she hasn't been since the
 * 7th" is the first thing a pastor wants to know before ringing.
 */
export async function attendanceGlance(env: Env, personId: number, today: string = churchDate()):
  Promise<{ lastSeen: string | null; weeks: number }> {
  const db = getDb(env);
  const kids = sql.join(KIDS_KIND_IDS.map((k) => sql`${k}`), sql`, `);
  const [row] = await db.all<{ lastSeen: string | null; weeks: number }>(sql`
    SELECT
      (SELECT max(s.date) FROM attendance a JOIN services s ON s.id = a.service_id
        WHERE a.person_id = ${personId} AND s.kind NOT IN (${kids})) AS lastSeen,
      -- Weeks, not services, the same as the missing rule: back six days, then
      -- forward to a Sunday, is the Sunday each date's week starts on.
      (SELECT count(DISTINCT date(s.date, '-6 days', 'weekday 0'))
        FROM attendance a JOIN services s ON s.id = a.service_id
        WHERE a.person_id = ${personId} AND s.kind NOT IN (${kids})
          AND s.date > ${addDays(today, -84)} AND s.date <= ${today}) AS weeks
  `);
  return { lastSeen: row?.lastSeen ?? null, weeks: Number(row?.weeks ?? 0) };
}

/* --------------------------------------------------------- guest cards -- */

/**
 * A card from the public site: store it, put it on the list, and tell the
 * pastors if they asked to be told.
 *
 * The alert is QUEUED, not sent from here: the visitor's phone is waiting on
 * this request, and the five-minute cron that sends everything else sends this
 * too, with the same claim-before-send protection. A card that arrives during
 * the service reaches the pastor's phone before the closing hymn.
 */
export async function createGuestCard(
  env: Env, card: GuestDraft, ipHash: string | null, appOrigin: string,
): Promise<number> {
  const db = getDb(env);
  const at = nowIso();
  const [row] = await db.insert(schema.guestCards).values({
    firstName: card.firstName, lastName: card.lastName,
    phone: card.phone, phoneE164: card.phoneE164, email: card.email,
    kind: card.kind, visitDate: card.visitDate, firstTime: card.firstTime,
    wants: JSON.stringify(card.wants), message: card.message, party: card.party,
    heardFrom: card.heardFrom,
    smsConsent: card.smsConsent,
    smsConsentSource: card.smsConsent ? 'guest-card' : null,
    smsConsentAt: card.smsConsent ? at : null,
    ipHash, createdAt: at,
  }).returning({ id: schema.guestCards.id });
  const id = row!.id;

  await db.insert(schema.careItems).values({
    guestId: id, kind: 'guest', reason: guestReason(card),
    dueOn: churchDate(), sourceKey: guestKey(id), status: 'open',
    createdBy: 'guest card', createdAt: at,
  }).onConflictDoNothing();

  const settings = await getCareSettings(env);
  if (settings.alertOn && (await cardsInLastHour(env)) <= ALERTS_PER_HOUR) {
    const body = guestAlertBody(card, `${appOrigin}/care/guest/${id}`);
    for (const r of await reachableRecipients(env, settings.recipientIds)) {
      await db.insert(schema.scheduledMessages).values({
        sourceKey: `guest:${id}:${r.personId}`,
        // 'schedule', because that is what drainQueue sends.
        source: 'schedule', personId: r.personId, phoneE164: r.phoneE164,
        body, sendAt: at, status: 'pending', createdAt: at,
      }).onConflictDoNothing();
    }
  }
  return id;
}

/**
 * A ceiling on alert TEXTS, across every connection.
 *
 * The per-connection cap in the endpoint stops one phone filling the list; it
 * does nothing about a script that changes address every time, and each card
 * would otherwise be a text the church pays for. Past this many cards in an
 * hour the cards are still kept and still listed — only the texts stop, and a
 * real Sunday never comes near it.
 */
const ALERTS_PER_HOUR = 10;

async function cardsInLastHour(env: Env): Promise<number> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const [row] = await getDb(env).all<{ n: number }>(sql`
    SELECT count(*) AS n FROM guest_cards WHERE created_at > ${since}
  `);
  return Number(row?.n ?? 0);
}

/** How many cards this connection has sent in the last hour. */
export async function recentCardsFrom(env: Env, ipHash: string): Promise<number> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const [row] = await getDb(env).all<{ n: number }>(sql`
    SELECT count(*) AS n FROM guest_cards WHERE ip_hash = ${ipHash} AND created_at > ${since}
  `);
  return Number(row?.n ?? 0);
}

export async function guestById(env: Env, id: number) {
  const rows = await getDb(env).select().from(schema.guestCards)
    .where(eq(schema.guestCards.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function recentGuests(env: Env, limit = 50) {
  return getDb(env).select().from(schema.guestCards)
    .orderBy(desc(schema.guestCards.createdAt)).limit(limit);
}

/**
 * Turn a card into a person on the People list.
 *
 * What they told us, and nothing assumed:
 *   - adult/child stays 'unknown' — a card does not say, and the rest of the
 *     app treats unknown safely (out of the directory) until someone decides;
 *   - never in the directory — that is consent given in person, always;
 *   - texting consent is carried over ONLY if they ticked the box AND the
 *     number has not since said STOP anywhere, checked at this moment rather
 *     than trusted from the card.
 *
 * Their notes and follow-ups come with them, so their history is one history.
 * Doing it twice returns the person already made.
 */
export async function guestToPerson(env: Env, guestId: number, by: Actor): Promise<number | null> {
  const db = getDb(env);
  const g = await guestById(env, guestId);
  if (!g) return null;
  if (g.personId) return g.personId;

  let consent: 'opted_in' | 'unknown' = 'unknown';
  if (g.smsConsent === 'opted_in' && g.phoneE164) {
    const state = (await consentByNumbers(db, [g.phoneE164])).get(g.phoneE164);
    if (state === 'opted_in') consent = 'opted_in';
  }

  const at = nowIso();
  const [person] = await db.insert(schema.people).values({
    firstName: g.firstName, lastName: g.lastName ?? '',
    phone: g.phone, phoneE164: g.phoneE164, email: g.email,
    adultChild: 'unknown', includeInDirectory: false,
    smsConsent: consent,
    ...(consent === 'opted_in'
      ? { smsConsentSource: 'guest-card', smsConsentAt: g.smsConsentAt ?? at } : {}),
    notes: `Added from a guest card (${shortDate(dayOf(g.createdAt))}) by ${actorName(by)}.`,
    createdAt: at, updatedAt: at,
  }).returning({ id: schema.people.id });
  const personId = person!.id;

  await db.update(schema.guestCards).set({ personId }).where(eq(schema.guestCards.id, guestId));
  await db.update(schema.careNotes).set({ personId }).where(eq(schema.careNotes.guestId, guestId));
  await db.update(schema.careItems).set({ personId }).where(eq(schema.careItems.guestId, guestId));
  return personId;
}

/** A card that is spam, or was sent twice. Its follow-up and notes go with it. */
export async function deleteGuest(env: Env, guestId: number): Promise<void> {
  const db = getDb(env);
  // Explicitly, rather than trusting the cascade to be switched on.
  await db.delete(schema.careNotes).where(eq(schema.careNotes.guestId, guestId));
  await db.delete(schema.careItems).where(eq(schema.careItems.guestId, guestId));
  await db.delete(schema.guestCards).where(eq(schema.guestCards.id, guestId));
}

/* ------------------------------------------------------------ settings -- */

const KEYS = {
  digestOn: 'care_digest_on',
  digestTime: 'care_digest_time',
  alertOn: 'care_alert_on',
  recipients: 'care_recipients',
} as const;

/** Missing or broken values fall back to OFF and to nobody — never to texting
 *  somebody because a read failed. Same rule as the birthday settings. */
export async function getCareSettings(env: Env): Promise<CareSettings> {
  const out: CareSettings = { digestOn: false, digestTime: DEFAULT_DIGEST_TIME, alertOn: false, recipientIds: [] };
  try {
    const rows = await getDb(env).select().from(schema.appSettings)
      .where(inArray(schema.appSettings.key, Object.values(KEYS)));
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    out.digestOn = get(KEYS.digestOn) === '1';
    out.alertOn = get(KEYS.alertOn) === '1';
    const t = get(KEYS.digestTime);
    if (t && parseHhmm(t) !== null) out.digestTime = t;
    out.recipientIds = parseIdList(get(KEYS.recipients));
  } catch { /* defaults */ }
  return out;
}

export async function setCareSettings(env: Env, s: CareSettings, by: string): Promise<string | null> {
  if (parseHhmm(s.digestTime) === null) return 'Pick a time of day for the digest.';
  if ((s.digestOn || s.alertOn) && !s.recipientIds.length) {
    return 'Choose who should get these texts first.';
  }
  const db = getDb(env);
  const pairs: [string, string][] = [
    [KEYS.digestOn, s.digestOn ? '1' : '0'],
    [KEYS.digestTime, s.digestTime],
    [KEYS.alertOn, s.alertOn ? '1' : '0'],
    [KEYS.recipients, JSON.stringify(s.recipientIds)],
  ];
  for (const [key, value] of pairs) {
    await db.insert(schema.appSettings)
      .values({ key, value, updatedAt: nowIso(), updatedBy: by })
      .onConflictDoUpdate({ target: schema.appSettings.key,
                            set: { value, updatedAt: nowIso(), updatedBy: by } });
  }
  return null;
}

/**
 * The chosen people who can actually be texted right now.
 *
 * Consent is checked here, at the moment of sending, exactly as every other
 * audience checks it: choosing somebody in settings is not an override, and an
 * opt-out still means opt-out. One text per handset.
 */
export async function reachableRecipients(env: Env, ids: number[]):
  Promise<{ personId: number; phoneE164: string; firstName: string }[]> {
  if (!ids.length) return [];
  const rows = await getDb(env).select({
    id: schema.people.id, firstName: schema.people.firstName,
    phoneE164: schema.people.phoneE164, smsConsent: schema.people.smsConsent,
    archived: schema.people.archived,
  }).from(schema.people).where(inArray(schema.people.id, ids.slice(0, 50)));
  const seen = new Set<string>();
  const out: { personId: number; phoneE164: string; firstName: string }[] = [];
  for (const r of rows) {
    if (r.archived || !r.phoneE164 || r.smsConsent !== 'opted_in') continue;
    if (seen.has(r.phoneE164)) continue;
    seen.add(r.phoneE164);
    out.push({ personId: r.id, phoneE164: r.phoneE164, firstName: r.firstName });
  }
  return out;
}

/** Adults who could be chosen as recipients, for the settings picker. */
export async function recipientCandidates(env: Env) {
  return getDb(env).select({
    id: schema.people.id, firstName: schema.people.firstName, lastName: schema.people.lastName,
    phoneE164: schema.people.phoneE164, smsConsent: schema.people.smsConsent,
  }).from(schema.people)
    .where(and(eq(schema.people.archived, false), eq(schema.people.adultChild, 'adult')))
    .orderBy(schema.people.lastName, schema.people.firstName);
}
