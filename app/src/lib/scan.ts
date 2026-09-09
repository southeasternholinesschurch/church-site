/**
 * Making sense of whatever a scan hands over.
 *
 * Three things can arrive at the kiosk, and they are not the same:
 *
 *   a URL  — Web NFC on Android reads the NDEF record we wrote to the tag,
 *            which is the full https://…/kids/card/<token> address.
 *   a token — a QR scanner or a reader configured to emit the record's text
 *            may hand over just the token part.
 *   a UID  — a keyboard-emulation reader usually types the tag's serial
 *            number instead, which is NOT something we wrote and NOT secret.
 *
 * The distinction is kept all the way through, because a UID may only check a
 * child in while a token opens their profile. See the comment on kid_cards.uid.
 *
 * Pure and unit-tested — this parses attacker-adjacent input (anything can be
 * typed at a kiosk in a hallway) and it is the wrong place to be clever.
 */

export type Scan =
  | { kind: 'token'; value: string }
  | { kind: 'uid'; value: string };

/** Our tokens are randomToken(32) — 64 lower-case hex characters. */
const TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * A tag UID is 4, 7 or 10 bytes. Readers write them in all sorts of ways —
 * with colons, with spaces, upper or lower case — so they are normalised to
 * bare upper-case hex before they ever reach the database, or the same card
 * would fail to match itself depending on which reader read it.
 */
const UID_RE = /^[0-9A-F]{8}$|^[0-9A-F]{14}$|^[0-9A-F]{20}$/;

export function parseScan(raw: string | null | undefined): Scan | null {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 512) return null;

  // A URL from an NDEF record. Only OUR card path counts: a tag someone else
  // wrote, pointing anywhere else, must not be followed or trusted.
  if (/^https?:\/\//i.test(s)) {
    let path: string;
    try { path = new URL(s).pathname; } catch { return null; }
    const m = /^\/kids\/card\/([0-9a-f]{64})$/.exec(path);
    return m ? { kind: 'token', value: m[1]! } : null;
  }

  const bare = s.toLowerCase();
  if (TOKEN_RE.test(bare)) return { kind: 'token', value: bare };

  const uid = s.replace(/[\s:.-]/g, '').toUpperCase();
  if (UID_RE.test(uid)) return { kind: 'uid', value: uid };

  return null;
}
