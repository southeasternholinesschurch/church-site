import type { APIRoute } from 'astro';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../../db';
import { parseScan } from '../../lib/scan';
import { isDemoInstance } from '../../lib/demo-instance';
import { touchKiosk } from '../../lib/kiosk';
import { churchToday, likelyKidsKind, KIDS_KIND_IDS } from '../../lib/services';
import { getPerVisit, balanceOf } from '../../lib/bucks';

/**
 * A card, held to the tablet.
 *
 * Runs under the KIOSK principal — the middleware branch put it there and
 * `locals.user` is not set. Everything this endpoint may do is in this file,
 * and the list is short: find the child, mark them present, credit them once,
 * and say their first name back.
 *
 * What it deliberately never returns: a surname, an address, a guardian, an
 * allergy, or an id that could be walked. The response is what a hallway may
 * see, because a hallway is where it is displayed.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const kiosk = locals.kiosk;
  if (!kiosk) return json({ ok: false, reason: 'not-a-kiosk' }, 403);

  const env = locals.runtime.env;
  const db = getDb(env);

  const body = await request.json().catch(() => null) as
    { input?: string; demo?: boolean } | null;

  /*
   * THE DEMO'S PRETEND TAP.
   *
   * On the public demo there is no card and no reader, so a key press picks an
   * invented child and runs the real path — the same attendance write, the same
   * credit, the same guard. It is the only way to show somebody what a scan
   * looks like without handing them a tag.
   *
   * Gated on isDemoInstance, which is a separate Worker with a separate
   * database of invented people. On the real kiosk a stray keystroke must never
   * mark a child present, so this branch cannot exist there — not hidden, not
   * disabled, absent.
   */
  let card: { personId: number } | undefined;

  if (body?.demo === true && isDemoInstance(env)) {
    const pool = await db.select({ personId: schema.kidCards.personId })
      .from(schema.kidCards)
      .innerJoin(schema.people, eq(schema.people.id, schema.kidCards.personId))
      .where(and(eq(schema.kidCards.active, true), eq(schema.people.archived, false)))
      .limit(60);
    if (pool.length === 0) return json({ ok: false, reason: 'unknown-card' });
    card = pool[Math.floor(Math.random() * pool.length)];
  } else {
    const scan = parseScan(body?.input);
    // An unreadable scan is not an error worth explaining on a screen children
    // are looking at. "Try again" is the whole of the useful information.
    if (!scan) return json({ ok: false, reason: 'unreadable' });

    /*
     * A UID may check a child in. A token may too. Neither does anything else
     * from here — this endpoint has no other capability to grant, which is why
     * accepting the weaker of the two credentials is safe.
     */
    [card] = await db.select({ personId: schema.kidCards.personId })
      .from(schema.kidCards)
      .where(and(
        scan.kind === 'token'
          ? eq(schema.kidCards.token, scan.value)
          : eq(schema.kidCards.uid, scan.value),
        eq(schema.kidCards.active, true),
      )).limit(1);
  }

  if (!card) return json({ ok: false, reason: 'unknown-card' });

  const [child] = await db.select({
    id: schema.people.id,
    firstName: schema.people.firstName,
    className: schema.kidClasses.name,
  }).from(schema.people)
    .leftJoin(schema.kidProfiles, eq(schema.kidProfiles.personId, schema.people.id))
    .leftJoin(schema.kidClasses, eq(schema.kidClasses.id, schema.kidProfiles.classId))
    .where(and(eq(schema.people.id, card.personId), eq(schema.people.archived, false)))
    .limit(1);

  if (!child) return json({ ok: false, reason: 'unknown-card' });

  /*
   * Which meeting this is.
   *
   * An existing Fairhaven Kids service for today wins — a director may already have
   * opened the register from their phone, and a second service for the same
   * morning would split the register in two. Otherwise the first child through
   * the door creates it, which is right: they have arrived, so there is a
   * meeting.
   */
  const today = churchToday();
  const [existing] = await db.select({ id: schema.services.id })
    .from(schema.services)
    .where(and(eq(schema.services.date, today), inArray(schema.services.kind, KIDS_KIND_IDS)))
    .limit(1);

  let serviceId = existing?.id;
  if (!serviceId) {
    const kind = likelyKidsKind(today);
    // No Fairhaven Kids meeting today and none opened by hand. Refusing beats inventing
    // a Tuesday service that then shows up in every count.
    if (!kind) return json({ ok: false, reason: 'no-meeting' });
    const created = await db.insert(schema.services)
      .values({ date: today, kind, createdAt: nowIso() })
      .returning({ id: schema.services.id });
    serviceId = created[0]!.id;
  }

  // Were they already here? Asked BEFORE the write, so the screen can say
  // "you're already checked in" rather than silently doing nothing.
  const [already] = await db.select({ id: schema.attendance.id })
    .from(schema.attendance)
    .where(and(eq(schema.attendance.serviceId, serviceId),
               eq(schema.attendance.personId, child.id))).limit(1);

  /*
   * class_id stays NULL: this records "arrived at church", not "was in Miss
   * Karen's class". The teacher's register claims the same row later and sets
   * it — one row, never two, which is the whole of §5.1.
   */
  await db.insert(schema.attendance)
    .values({ serviceId, personId: child.id, classId: null, createdAt: nowIso() })
    .onConflictDoNothing();

  /*
   * And the credit, guarded by kid_ledger_attendance_once. A child who taps
   * four times gets one, because a second row cannot exist — no locking, no
   * check to forget. staff_id is null: a kiosk is not a person.
   */
  const perVisit = await getPerVisit(db);
  if (perVisit > 0) {
    await db.insert(schema.kidLedger).values({
      personId: child.id, delta: perVisit, reason: 'attendance', serviceId,
      staffId: null, kioskDeviceId: kiosk.id, createdAt: nowIso(),
    }).onConflictDoNothing();
  }

  const ledger = await db.select({ delta: schema.kidLedger.delta })
    .from(schema.kidLedger).where(eq(schema.kidLedger.personId, child.id));

  await touchKiosk(env, kiosk.id);

  return json({
    ok: true,
    // FIRST NAME ONLY. This is read across a hallway by whoever is standing
    // there; a surname is not theirs to broadcast.
    firstName: child.firstName,
    className: child.className,
    bucks: balanceOf(ledger),
    already: Boolean(already),
  });
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
