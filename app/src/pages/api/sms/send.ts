import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../../../db';
import { isDemoInstance, DEMO_SEND_REFUSED } from '../../../lib/demo-instance';
import { buildAudience } from '../../../lib/recipients';
import { countSegments, sendOne, smsConfigured } from '../../../lib/sms';

/**
 * Sends one composed message to a group, IN SLICES.
 *
 * Sequential, one message per HANDSET, and it never aborts. A single bad
 * number must not strand everyone after it in the loop — each failure is
 * recorded against that recipient and the batch carries on.
 *
 * The slicing is not tidiness, it is the whole point. A Worker on Cloudflare's
 * free plan may make 50 outbound requests per INCOMING request, and every text
 * is one. This route used to loop over the whole audience in a single call, so
 * a broadcast to 75 people sent 51 and then threw on every one after that —
 * logged as 'failed' with no Twilio error code, because Twilio was never
 * reached. Nobody noticed until people said they had not received a text:
 * three broadcasts dropped 19, 21 and 24 recipients that way.
 *
 * So the caller asks for a window (`offset`), gets back how many remain, and
 * calls again until none do. Each call stays well under the cap.
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
    { body?: string; groupId?: number | null; to?: string; offset?: number } | null;
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
    audience = await buildAudience(env, groupId);
    if (!audience.handsets.length) return json({ error: 'Nobody in that group can be texted.' }, 400);
  }

  const db = getDb(env);
  const { segments } = countSegments(text);
  let sent = 0;
  const failures: { name: string; reason: string }[] = [];

  // The window this call is responsible for. buildAudience is deterministic,
  // so the same group always yields the same order and the windows tile
  // cleanly across calls without anyone being sent to twice or skipped.
  const offset = Math.max(0, Number(body?.offset ?? 0));
  const slice = audience.handsets.slice(offset, offset + PER_CALL);
  const remaining = Math.max(0, audience.handsets.length - (offset + slice.length));

  for (const handset of slice) {
    const result = await sendOne(env, handset.phoneE164, text);

    // One log row PER PERSON so each person's history is complete, but the
    // segments are counted once per handset — otherwise a shared family phone
    // would be billed twice in the cost readout for one actual message.
    const logFor = handset.people.length ? handset.people
      : [{ personId: null as number | null, name: handset.phoneE164, phoneE164: handset.phoneE164 }];
    for (const [i, person] of logFor.entries()) {
      await db.insert(schema.messageLog).values({
        personId: person.personId,
        phoneE164: handset.phoneE164,
        body: text,
        direction: 'out',
        twilioSid: result.sid ?? null,
        status: result.ok ? (result.status ?? 'queued') : 'failed',
        errorCode: result.errorCode ?? null,
        segments: i === 0 ? segments : 0,
        createdAt: nowIso(),
      });
    }

    if (result.ok) sent++;
    else failures.push({ name: handset.people.map((p) => p.name).join(' / '),
                         reason: result.error ?? result.errorCode ?? 'unknown' });
  }

  return json({ sent, failed: failures.length, failures, segments,
                people: audience.recipients.length,
                // What the caller needs to finish the job.
                handsets: audience.handsets.length,
                nextOffset: remaining > 0 ? offset + slice.length : null,
                remaining });
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
