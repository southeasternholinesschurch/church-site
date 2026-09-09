import type { APIRoute } from 'astro';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../../db';
import { isDemoInstance, DEMO_SEND_REFUSED } from '../../lib/demo-instance';
import { countSegments, sendOne, smsConfigured } from '../../lib/sms';
import { kidsSendScope, mayTextRoute } from '../../lib/permissions';
import { buildKidsAudience } from '../../lib/kids-recipients';

/**
 * Sending a text to a bus route, IN SLICES.
 *
 * Under /kids rather than /api, because the permission allowlist denies /api/*
 * to volunteers by design — a bus captain has to be able to reach this, and
 * moving the allowlist to accommodate it would weaken the rule that protects
 * everything else.
 *
 * Every text goes through sendOne, whose first line is the demo guard. There is
 * exactly one function in this app that talks to Twilio and this is not a
 * second one.
 *
 * The slicing is not tidiness. A Worker may make 50 outbound requests per
 * incoming request and every text is one; the main sender learned that by
 * silently dropping 19, 21 and 24 recipients from three broadcasts. Bus routes
 * are small enough that one call will usually do — but "usually" is exactly how
 * that happened.
 */
const PER_CALL = 40;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'not signed in' }, 401);

  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host)
    return json({ error: 'bad origin' }, 403);

  const env = locals.runtime.env;
  const db = getDb(env);

  const body = await request.json().catch(() => null) as
    { text?: string; routeId?: number | null; offset?: number } | null;

  const text = String(body?.text ?? '').trim();
  if (!text) return json({ error: 'The message is empty.' }, 400);

  /*
   * THE SENDER'S SCOPE, READ FROM THE DATABASE — never from the request.
   *
   * A captain submitting a route id they were not assigned must reach nobody
   * new. That is a stated release requirement, and it is enforced here rather
   * than by the dropdown having been rendered without that option.
   */
  const assigned = await db.select({ routeId: schema.kidRouteCaptains.routeId })
    .from(schema.kidRouteCaptains)
    .where(eq(schema.kidRouteCaptains.staffId, user.id))
    .orderBy(asc(schema.kidRouteCaptains.routeId));
  const scope = kidsSendScope(user.role, user.kidsCanText, assigned.map((a) => a.routeId));
  if (scope === null) return json({ error: 'You do not have permission to send [Kids Ministry] texts.' }, 403);

  const routeId = body?.routeId == null ? null : Number(body.routeId);
  if (routeId !== null && !Number.isInteger(routeId)) return json({ error: 'bad route' }, 400);
  // "Everyone" is only available to somebody whose scope IS everyone.
  if (routeId === null && scope !== 'all')
    return json({ error: 'You can only text the routes you are assigned to.' }, 403);
  if (routeId !== null && !mayTextRoute(scope, routeId))
    return json({ error: 'You are not assigned to that route.' }, 403);

  /*
   * Configuration is checked AFTER authorisation, deliberately.
   *
   * Somebody asking for a route they do not hold should be told that, not told
   * whether the church's texting is otherwise ready to go — and when this ran
   * the other way round, a captain probing another route got "Twilio is not
   * configured", which hid the refusal from the very test meant to prove it.
   */
  if (isDemoInstance(env)) return json({ error: DEMO_SEND_REFUSED }, 400);
  if (!smsConfigured(env)) return json({ error: 'Twilio is not configured yet.' }, 400);

  const audience = await buildKidsAudience(db, routeId === null ? 'all' : [routeId]);
  if (audience.handsets.length === 0)
    return json({ error: 'Nobody on that route can be texted.' }, 400);

  const segments = countSegments(text).segments;
  const offset = Math.max(0, Number(body?.offset ?? 0));
  const slice = audience.handsets.slice(offset, offset + PER_CALL);
  const remaining = Math.max(0, audience.handsets.length - (offset + slice.length));

  let sent = 0, failed = 0;
  for (const handset of slice) {
    // Never aborts: one bad number must not strand everyone after it.
    const result = await sendOne(env, handset.phoneE164, text);
    if (result.sid) sent++; else failed++;

    /*
     * One log row per PERSON so each history is complete, but the segments are
     * counted once per handset — a shared family phone billed twice would
     * inflate the month-to-date readout for one actual message.
     *
     * person_id is null for a guardian who is not a member, which is most of
     * them. That is the cost of keeping bus families out of `people`, and the
     * log tolerates it: the column has always been nullable for inbound texts
     * from numbers nobody recognises.
     */
    for (const [i, person] of handset.people.entries()) {
      await db.insert(schema.messageLog).values({
        personId: person.personId,
        phoneE164: handset.phoneE164,
        body: text,
        direction: 'out',
        twilioSid: result.sid ?? null,
        status: result.sid ? 'queued' : 'failed',
        errorCode: result.error ?? null,
        segments: i === 0 ? segments : 0,
        // Marks the conversation as the children's section's — see 0018.
        context: 'kids',
        createdAt: nowIso(),
      });
    }
  }

  return json({ sent, failed, remaining, total: audience.handsets.length });
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
