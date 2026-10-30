import type { APIRoute } from 'astro';
import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '../../../db';
import { isDemoInstance, DEMO_SEND_REFUSED } from '../../../lib/demo-instance';
import { buildAudience } from '../../../lib/recipients';
import { smsConfigured } from '../../../lib/sms';
import { drainQueue, NOW_PREFIX } from '../../../lib/schedule-runner';
import { broadcastPrefix, broadcastProgress, enqueueBroadcast, isBroadcastId } from '../../../lib/broadcast';

/**
 * Sends one composed message, through the QUEUE.
 *
 * The first call (a `broadcastId` and the message) puts every recipient in the
 * queue, one row per handset, then sends the first 40. Later calls
 * (`continue: true`) send the next 40 of the same broadcast. If the page stops
 * calling (a locked phone, a closed tab), the five-minute cron sends the rest.
 * See lib/broadcast.ts for why: the browser used to hold the only copy of who
 * was still to be sent to.
 *
 * Forty a call, because a Worker may make 50 outbound requests per incoming
 * request and every text is one. This route once looped over a whole audience
 * in one call and dropped everybody past the 51st, logged as 'failed' with no
 * Twilio error code because Twilio was never reached.
 */
const PER_CALL = 40;
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'not signed in' }, 401);

  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host)
    return json({ error: 'bad origin' }, 403);

  const env = locals.runtime.env;
  /*
   * On the demo, say what is TRUE rather than what is technically accurate.
   * The demo Worker has no Twilio credentials, so this check catches it first
   * and "not configured yet" reads as a broken product to somebody evaluating
   * it — when in fact the send is refused on purpose, twice over.
   */
  if (isDemoInstance(env)) return json({ error: DEMO_SEND_REFUSED }, 400);
  if (!smsConfigured(env)) return json({ error: 'Twilio is not configured yet.' }, 400);

  const body = (await request.json().catch(() => null)) as
    { body?: string; groupId?: number | null; personIds?: number[];
      to?: string; broadcastId?: string; continue?: boolean } | null;
  if (!isBroadcastId(body?.broadcastId)) return json({ error: 'Reload the page and try again.' }, 400);
  const broadcastId = body!.broadcastId as string;

  // A later call: carry on sending what this broadcast already queued.
  if (body?.continue) return json(await finishEvenIfDropped(locals, sendSome(locals.runtime.env, broadcastId)));

  const text = (body?.body ?? '').trim();
  if (!text) return json({ error: 'The message is empty.' }, 400);

  const db0 = getDb(env);
  let audience: Awaited<ReturnType<typeof buildAudience>>;

  if (body?.to) {
    /**
     * Replying to one person from the inbox. Deliberately NOT routed through
     * buildAudience: that filters by consent, and someone who has just texted
     * the church a question should get an answer even if they are opted out of
     * broadcasts. Answering a message is not marketing.
     */
    const to = String(body.to);
    if (!/^\+[1-9]\d{7,14}$/.test(to)) return json({ error: 'That is not a usable number.' }, 400);
    const who = await db0.select({ id: schema.people.id, firstName: schema.people.firstName,
                                   lastName: schema.people.lastName })
      .from(schema.people).where(eq(schema.people.phoneE164, to)).limit(1);
    const person = who[0];
    audience = {
      recipients: person ? [{ personId: person.id, name: `${person.firstName} ${person.lastName}`, phoneE164: to }] : [],
      handsets: [{ phoneE164: to, people: person
        ? [{ personId: person.id, name: `${person.firstName} ${person.lastName}`, phoneE164: to }] : [] }],
      excluded: { noNumber: 0, optedOut: 0, noConsent: 0 },
    };
  } else {
    const groupId = body?.groupId ? Number(body.groupId) : null;
    /*
     * A hand-picked list of people, from the compose screen.
     *
     * Sanitised to positive integers here rather than trusted, and then handed
     * to buildAudience, which applies the SAME consent filter it applies to a
     * group. Picking somebody by name is not a way around their opt-out — it
     * just means the send reaches fewer people than were ticked.
     */
    const personIds = Array.isArray(body?.personIds)
      ? body.personIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : null;
    audience = await buildAudience(env, groupId, personIds);
    if (!audience.handsets.length) {
      return json({ error: personIds
        ? 'None of the people you picked can be texted.'
        : 'Nobody in that group can be texted.' }, 400);
    }
  }

  /*
   * Everybody into the queue first, in one batch, before a single text goes.
   * From here on the queue, not this request, is what knows who is still to
   * be sent to.
   */
  const work = (async () => {
    await enqueueBroadcast(getDb(env), {
      prefix: NOW_PREFIX, broadcastId, body: text,
      groupId: body?.groupId ? Number(body.groupId) : null,
      handsets: audience.handsets.map((h) => ({ phoneE164: h.phoneE164, personId: h.people[0]?.personId ?? null })),
    });
    return sendSome(env, broadcastId);
  })();
  return json({ ...(await finishEvenIfDropped(locals, work)), people: audience.recipients.length });
};

/**
 * Keep the work going if the browser goes away.
 *
 * Cloudflare stops a request's work when the person who made it disconnects.
 * That is what happened on 2026-10-20: the work-day text reached 4 of 79 phones
 * in its first second, the phone went away, and the request was cut off with
 * nothing recorded. Registered with waitUntil, the queueing and this batch of
 * 40 finish regardless; anything after them is the cron's.
 */
function finishEvenIfDropped<T>(locals: App.Locals, work: Promise<T>): Promise<T> {
  locals.runtime?.ctx?.waitUntil(work.catch(() => undefined));
  return work;
}

/** Send up to PER_CALL more of this broadcast, and say where it has got to. */
async function sendSome(env: Env, broadcastId: string) {
  const db = getDb(env);
  const drained = await drainQueue(env, PER_CALL, broadcastPrefix(NOW_PREFIX, broadcastId));

  // Names for anybody it failed for, so the person pressing Send knows who.
  const ids = drained.failures.map((f) => f.personId).filter((n): n is number => n !== null);
  const names = ids.length
    ? await db.select({ id: schema.people.id, first: schema.people.firstName, last: schema.people.lastName })
        .from(schema.people).where(inArray(schema.people.id, ids))
    : [];
  const nameOf = (id: number | null, phone: string) => {
    const p = names.find((n) => n.id === id);
    return p ? `${p.first} ${p.last}` : phone;
  };

  const progress = await broadcastProgress(db, NOW_PREFIX, broadcastId);
  return {
    sent: progress.sent, failed: progress.failed, handsets: progress.total, remaining: progress.pending,
    failures: drained.failures.map((f) => ({ name: nameOf(f.personId, f.phoneE164), reason: f.reason })),
  };
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
