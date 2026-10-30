import type { APIRoute } from 'astro';
import { asc, eq } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { isDemoInstance, DEMO_SEND_REFUSED } from '../../lib/demo-instance';
import { smsConfigured } from '../../lib/sms';
import { drainQueue, KIDS_NOW_PREFIX } from '../../lib/schedule-runner';
import { broadcastPrefix, broadcastProgress, enqueueBroadcast, isBroadcastId } from '../../lib/broadcast';
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
 *
 * THROUGH THE QUEUE, like the main sender (lib/broadcast.ts): the first call
 * queues every handset, then each call sends 40. If the volunteer's phone
 * locks mid-send, the five-minute cron sends the rest. Queue keys start
 * `kidsnow:`, which is how the log rows are marked as the Fairhaven Kids section's.
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
    { text?: string; routeId?: number | null; broadcastId?: string; continue?: boolean } | null;
  if (!isBroadcastId(body?.broadcastId)) return json({ error: 'Reload the page and try again.' }, 400);
  const broadcastId = body!.broadcastId as string;

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
  if (scope === null) return json({ error: 'You do not have permission to send Fairhaven Kids texts.' }, 403);

  // A later call: send more of what this broadcast already queued (and was
  // authorised for when it was queued).
  if (body?.continue) {
    const more = sendSome(env, broadcastId);
    locals.runtime?.ctx?.waitUntil(more.catch(() => undefined));   // see api/sms/send.ts
    return json(await more);
  }

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

  // Finishes even if the volunteer's phone drops the connection: see
  // finishEvenIfDropped in api/sms/send.ts.
  const work = (async () => {
    await enqueueBroadcast(db, {
      prefix: KIDS_NOW_PREFIX, broadcastId, body: text, groupId: null,
      handsets: audience.handsets.map((h) => ({ phoneE164: h.phoneE164, personId: h.people[0]?.personId ?? null })),
    });
    return sendSome(env, broadcastId);
  })();
  locals.runtime?.ctx?.waitUntil(work.catch(() => undefined));
  return json(await work);
};

async function sendSome(env: Env, broadcastId: string) {
  await drainQueue(env, PER_CALL, broadcastPrefix(KIDS_NOW_PREFIX, broadcastId));
  const p = await broadcastProgress(getDb(env), KIDS_NOW_PREFIX, broadcastId);
  return { sent: p.sent, failed: p.failed, remaining: p.pending, total: p.total };
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
