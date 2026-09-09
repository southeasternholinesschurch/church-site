import type { APIRoute } from 'astro';
import { and, desc, eq } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../../db';
import { tally } from '../../lib/tally';

/**
 * Every write the check-in screen makes, in one endpoint.
 *
 * The session cookie is SameSite=Lax, so a cross-site POST arrives without it
 * and the middleware has already rejected the request before this runs — that
 * is the CSRF defence. The origin check below is belt and braces.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'not signed in' }, 401);

  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host)
    return json({ error: 'bad origin' }, 403);

  const env = locals.runtime.env;
  const db = getDb(env);
  const body = await request.json().catch(() => null) as any;
  if (!body?.action) return json({ error: 'no action' }, 400);

  const serviceId = Number(body.serviceId);

  switch (body.action) {
    case 'toggle': {
      const personId = Number(body.personId);
      if (!serviceId || !personId) return json({ error: 'bad ids' }, 400);
      const existing = await db.select({ id: schema.attendance.id }).from(schema.attendance)
        .where(and(eq(schema.attendance.serviceId, serviceId), eq(schema.attendance.personId, personId)))
        .limit(1);
      if (existing[0]) {
        await db.delete(schema.attendance).where(eq(schema.attendance.id, existing[0].id));
        return json({ present: false, ...(await counts(db, serviceId)) });
      }
      await db.insert(schema.attendance)
        .values({ serviceId, personId, createdAt: nowIso() })
        .onConflictDoNothing();
      return json({ present: true, ...(await counts(db, serviceId)) });
    }

    case 'add-visitor': {
      if (!serviceId) return json({ error: 'bad service' }, 400);
      const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
      const inserted = await db.insert(schema.visitors).values({
        serviceId, name,
        // Check-in asks for a name and nothing else, so this is genuinely
        // unknown rather than assumed. Kept settable for a future flow.
        adultChild: body.adultChild === 'child' ? 'child'
                  : body.adultChild === 'adult' ? 'adult' : 'unknown',
        firstTime: Boolean(body.firstTime),
        createdAt: nowIso(),
      }).returning({ id: schema.visitors.id });
      return json({ visitor: { id: inserted[0]!.id }, ...(await counts(db, serviceId)) });
    }

    case 'add-person': {
      const firstName = String(body.firstName ?? '').trim();
      const lastName = String(body.lastName ?? '').trim();
      if (!firstName || !lastName) return json({ error: 'A first and last name are both needed.' }, 400);
      const adultChild = ['adult', 'child'].includes(body.adultChild) ? body.adultChild : 'unknown';
      const inserted = await db.insert(schema.people).values({
        firstName, lastName, adultChild,
        // NOT added to the directory. Consent is gathered in person by the
        // pastor, never implied by someone being typed in at a door.
        includeInDirectory: false,
        createdAt: nowIso(), updatedAt: nowIso(),
      }).returning({ id: schema.people.id });
      const personId = inserted[0]!.id;
      // Someone added during check-in is, by definition, here.
      if (serviceId) await db.insert(schema.attendance)
        .values({ serviceId, personId, createdAt: nowIso() }).onConflictDoNothing();
      return json({ person: { id: personId, firstName, lastName, adultChild }, ...(await counts(db, serviceId)) });
    }

    case 'remove-visitor': {
      // One-tap adding makes mis-taps inevitable, so removal has to be as easy.
      // Visitors are anonymous headcount with no history hanging off them, so
      // unlike a person this really is a delete.
      const visitorId = Number(body.visitorId);
      if (!serviceId) return json({ error: 'bad service' }, 400);
      if (visitorId) {
        await db.delete(schema.visitors)
          .where(and(eq(schema.visitors.id, visitorId), eq(schema.visitors.serviceId, serviceId)));
      } else {
        // No id: drop the most recent, which is what "undo that tap" means.
        const last = await db.select({ id: schema.visitors.id }).from(schema.visitors)
          .where(eq(schema.visitors.serviceId, serviceId))
          .orderBy(desc(schema.visitors.id)).limit(1);
        if (last[0]) await db.delete(schema.visitors).where(eq(schema.visitors.id, last[0].id));
      }
      return json({ ...(await counts(db, serviceId)) });
    }

    case 'archive-person': {
      const personId = Number(body.personId);
      if (!personId) return json({ error: 'bad person' }, 400);
      // ARCHIVED, NEVER DELETED. Attendance rows reference this person; a hard
      // delete would cascade and silently change historical totals. Archiving
      // removes them from the list and the directory, and can be undone.
      await db.update(schema.people)
        .set({ archived: true, includeInDirectory: false, updatedAt: nowIso() })
        .where(eq(schema.people.id, personId));
      if (serviceId) await db.delete(schema.attendance)
        .where(and(eq(schema.attendance.serviceId, serviceId), eq(schema.attendance.personId, personId)));
      return json({ archived: true, ...(await counts(db, serviceId)) });
    }

    default:
      return json({ error: 'unknown action' }, 400);
  }
};

async function counts(db: ReturnType<typeof getDb>, serviceId: number) {
  if (!serviceId) return {};
  const present = await db.select({ adultChild: schema.people.adultChild })
    .from(schema.attendance)
    .innerJoin(schema.people, eq(schema.attendance.personId, schema.people.id))
    .where(eq(schema.attendance.serviceId, serviceId));
  const vis = await db.select({ adultChild: schema.visitors.adultChild, firstTime: schema.visitors.firstTime })
    .from(schema.visitors).where(eq(schema.visitors.serviceId, serviceId));

  return { ...tally(present, vis), firstTime: vis.filter((v) => v.firstTime).length };
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
