/**
 * Validating Twilio's webhook signature.
 *
 * Without this, ANY caller who finds the webhook URL can post a fake inbound
 * message — and since inbound STOP is what marks someone opted out, that is a
 * stranger being able to unsubscribe the congregation, or to fabricate replies
 * that appear in the staff inbox. The endpoint is public by necessity; the
 * signature is the only thing making it trustworthy.
 *
 * Twilio's scheme: take the full URL exactly as they called it, append each
 * POST parameter as key immediately followed by value, sorted by key, then
 * HMAC-SHA1 with the ACCOUNT AUTH TOKEN and base64 the result.
 *
 * Note it is the auth token specifically — an API key secret will not
 * validate, which is a good reason to keep the token set even after moving
 * sending to a scoped key.
 */

export async function isValidTwilioSignature(
  authToken: string, url: string, params: Record<string, string>, signature: string,
): Promise<boolean> {
  if (!authToken || !signature) return false;

  let data = url;
  for (const key of Object.keys(params).sort()) data += key + params[key];

  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  return timingSafeEqual(expected, signature);
}

/** Constant-time compare, so a wrong signature cannot be narrowed down by
 *  timing how long the rejection took. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Does this message body mean "stop texting me"?
 *
 * Twilio already handles the standard keywords at the carrier level and will
 * refuse to deliver to that number afterwards — but it will not tell our
 * database, so without this the app keeps listing them as a recipient, keeps
 * counting them in the audience, and every future send quietly fails for them.
 * Recorded on our side too.
 */
const STOP_WORDS = new Set([
  'stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'stop all', 'optout', 'opt out',
]);
export const isStopKeyword = (body: string) =>
  STOP_WORDS.has(body.trim().toLowerCase().replace(/[.!]+$/, ''));

// JOIN is included because it is what people actually type when a sign says
// "text START" — and a would-be subscriber whose word we do not recognise is
// simply never signed up, silently.
const START_WORDS = new Set([
  'start', 'join', 'yes', 'unstop', 'subscribe', 'optin', 'opt in', 'opt-in',
]);
export const isStartKeyword = (body: string) =>
  START_WORDS.has(body.trim().toLowerCase().replace(/[.!]+$/, ''));
