import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../../../db';
import { isValidTwilioSignature, isStopKeyword, isStartKeyword } from '../../../lib/twilio-signature';
import { readForm } from '../../../lib/form';
import { findConsentTargets, applyOptOut, applyOptIn, shouldCreatePersonOnStart } from '../../../lib/consent';

export const prerender = false;

/**
 * Twilio's callback: inbound texts AND delivery receipts.
 *
 * PUBLIC BY NECESSITY — Twilio has no session — so the signature check is the
 * only thing standing between this and a stranger. Everything below it assumes
 * the request is genuinely from Twilio, so the check happens first and an
 * unsigned request never reaches the database.
 *
 * Always answers 200 with empty TwiML once past the signature. A non-2xx makes
 * Twilio retry, and retrying a message we have already recorded achieves
 * nothing except a duplicate in the staff inbox.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const token = env.TWILIO_AUTH_TOKEN;

  /*
   * readForm, not request.formData() directly.
   *
   * This endpoint is PUBLIC — it has to be, Twilio carries no session — so
   * every scanner on the internet POSTs an empty body at it, and formData()
   * REJECTS on one. That was an unhandled rejection, which is a 500, several
   * times a day, on the one route in the app a stranger can reach.
   *
   * An unreadable body becomes an empty one, which then carries no signature
   * and is refused by the check below with a 403 — the same answer any other
   * unsigned request gets, and the correct one.
   */
  const form = await readForm(request);
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = String(v);

  // Twilio signs the URL it was configured with. Behind Cloudflare the Worker
  // sees that same public URL, so request.url is correct here — but if this
  // ever moves behind a proxy that rewrites the host, this is the line that
  // silently starts rejecting everything.
  const signature = request.headers.get('x-twilio-signature') ?? '';
  const ok = token && await isValidTwilioSignature(token, request.url, params, signature);
  if (!ok) return new Response('Invalid signature', { status: 403 });

  const db = getDb(env);
  const from = params.From ?? '';
  const body = params.Body ?? '';
  const sid = params.MessageSid ?? params.SmsSid ?? null;

  // --- delivery receipt: no Body, just a status for a message we sent -------
  if (params.MessageStatus && !params.Body) {
    if (sid) {
      const status = params.MessageStatus;
      await db.update(schema.messageLog)
        .set({ status, errorCode: params.ErrorCode ?? null })
        .where(eq(schema.messageLog.twilioSid, sid));

      /**
       * Twilio ACCEPTING a message is not the same as a phone receiving one,
       * and the gap between them is where a reminder disappears. A send is
       * recorded as done the moment Twilio takes it — which is right, because
       * that is the only way to guarantee it is not sent twice — but if the
       * carrier then rejects it, that record is a lie: the app believes
       * somebody was told and they were not.
       *
       * So a terminal failure reopens the reminder. The job runs hourly and
       * only inside its Monday/Tuesday window, so this means a retry while
       * that window is open and nothing at all afterwards — never a text
       * arriving days late.
       *
       * This is exactly what happened on 2026-09-01: both reminders were
       * accepted and then dropped with error 30034 (unregistered number),
       * and without this they would have stayed marked as sent forever.
       */
      if (status === 'undelivered' || status === 'failed') {
        const rows = await db.select({ smId: schema.messageLog.scheduledMessageId })
          .from(schema.messageLog).where(eq(schema.messageLog.twilioSid, sid)).limit(1);
        const smId = rows[0]?.smId;
        if (smId) {
          await db.update(schema.scheduledMessages)
            .set({ status: 'failed',
                   note: `Carrier did not deliver it${params.ErrorCode ? ` (error ${params.ErrorCode})` : ''}` })
            .where(eq(schema.scheduledMessages.id, smId));
        }
      }
    }
    return twiml();
  }

  // --- inbound message ------------------------------------------------------
  const person = from
    ? (await db.select({ id: schema.people.id }).from(schema.people)
        .where(eq(schema.people.phoneE164, from)).limit(1))[0]
    : undefined;

  await db.insert(schema.messageLog).values({
    personId: person?.id ?? null,
    phoneE164: from,
    body,
    direction: 'in',
    twilioSid: sid,
    status: 'received',
    segments: 0,                      // inbound is not billed to us per segment
    createdAt: nowIso(),
  });

  /**
   * Twilio already blocks delivery to a number that replied STOP, at the
   * carrier level. Recording it here as well is not redundant: without it the
   * app keeps counting that person in every audience and every future send
   * fails for them silently. Matched by NUMBER, so a shared handset opts out
   * everyone on it — which is correct, since one person asked and one phone
   * receives.
   *
   * APPLIED ACROSS BOTH TABLES holding a number — `people` and
   * `kid_guardians` — by lib/consent.ts. This used to touch `people` alone,
   * which meant a bus-ministry parent, whose number exists only as a guardian,
   * could text STOP and keep receiving texts from the children's section
   * indefinitely. The reply was logged, so it looked handled; nothing would
   * have surfaced the failure until a family complained, or quietly stopped
   * trusting the church's messages.
   */
  if (isStopKeyword(body) && from) {
    await applyOptOut(db, from);
  } else if (isStartKeyword(body) && from) {
    const targets = await findConsentTargets(db, from);
    // Opts in wherever this number already appears — a member, a guardian, or
    // the same human as both.
    await applyOptIn(db, from);

    if (shouldCreatePersonOnStart(targets)) {
      /**
       * A stranger opted in. Create them.
       *
       * Refusing because we do not know their name would mean an opt-in that
       * silently goes nowhere: they did the one thing the sign asked, and
       * would then never hear from the church and never appear anywhere staff
       * could see. The name can be filled in later; the consent and the number
       * cannot be recovered if they are dropped now.
       *
       * Marked needsProfile so it surfaces in the dashboard as work to do
       * rather than sitting as an anonymous row nobody notices. Left as
       * adult_child 'unknown', which keeps them out of the directory until a
       * person confirms who they are.
       *
       * NOT done when the number belongs to a guardian. A bus-ministry parent
       * texting START is already known, and creating a person row for them
       * would put them in the congregation's people list, the audience counts
       * and the attendance statistics — undoing, one text at a time, the whole
       * reason guardians are kept out of `people`.
       */
      const last4 = from.slice(-4);
      await db.insert(schema.people).values({
        firstName: 'New', lastName: `contact ${last4}`,
        phone: from, phoneE164: from,
        adultChild: 'unknown',
        includeInDirectory: false,
        needsProfile: true,
        smsConsent: 'opted_in', smsConsentSource: 'sms-start', smsConsentAt: nowIso(),
        notes: `Texted START from ${from} on ${nowIso().slice(0, 10)}. `
             + `Name and details still to be filled in.`,
        createdAt: nowIso(), updatedAt: nowIso(),
      }).onConflictDoNothing();

      // Attach the inbound message to the person we just made, so their
      // history starts with the text that signed them up.
      const created = await db.select({ id: schema.people.id }).from(schema.people)
        .where(eq(schema.people.phoneE164, from)).limit(1);
      if (created[0] && sid) {
        await db.update(schema.messageLog).set({ personId: created[0].id })
          .where(eq(schema.messageLog.twilioSid, sid));
      }
    }
  }

  return twiml();
};

/** Empty TwiML: acknowledged, and no auto-reply. Twilio sends its own
 *  confirmation for STOP/START, and a second message would be noise. */
const twiml = () =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response></Response>',
    { status: 200, headers: { 'content-type': 'text/xml' } });
