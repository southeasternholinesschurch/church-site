/**
 * Constant-time secret comparison.
 *
 * `a !== b` on a string short-circuits at the first differing byte, so how
 * long the comparison takes tells an attacker how much of the secret they got
 * right. Over the internet against a Worker that is a weak channel, but the
 * fix costs nothing and the endpoint this guards can spend real money on
 * Twilio sends.
 *
 * Both values are SHA-256'd first and the DIGESTS are compared. That is what
 * makes this length-safe: digests are always 32 bytes, so a wrong-length
 * secret takes exactly as long to reject as a right-length one. Comparing the
 * raw strings would need a length check first, and that check is itself a
 * timing signal — it would leak how long the secret is.
 */

/** True only if both strings are non-empty and identical. */
export async function secretsMatch(
  presented: string | null | undefined,
  expected: string | null | undefined,
): Promise<boolean> {
  // An absent secret on either side is a configuration failure, not a match.
  // Checked before hashing because hashing '' would otherwise compare equal
  // to another '' and authorise a request against an unset secret.
  if (!presented || !expected) return false;

  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(presented)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);

  // timingSafeEqual is a Cloudflare Workers extension to SubtleCrypto and is
  // absent in plain Node, where the tests run.
  //
  // Wrapped in try/catch rather than trusted: it throws on unequal byte
  // lengths, and if a future runtime change ever made it throw for some other
  // reason, an uncaught error here would 401-or-500 every cron run and the
  // Monday reminder would stop with no obvious cause. The fallback below is a
  // genuine constant-time compare over two fixed-length digests, not a
  // shortcut, so falling back costs nothing but the native call.
  const native = (crypto.subtle as unknown as {
    timingSafeEqual?: (x: ArrayBuffer, y: ArrayBuffer) => boolean;
  }).timingSafeEqual;
  if (typeof native === 'function') {
    try { return native.call(crypto.subtle, a, b); } catch { /* fall through */ }
  }

  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
