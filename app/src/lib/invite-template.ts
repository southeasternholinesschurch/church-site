/**
 * The invite wording — the pure half.
 *
 * Split from directory.ts for the same reason roster.ts is split from
 * roster-db.ts: directory.ts imports the database layer, which plain Node
 * cannot load, so anything living there cannot be unit-tested. The rules about
 * what makes a message valid are exactly the part that must be tested, so they
 * live here where a test can reach them.
 */

export const INVITE_LINK_TOKEN = '{link}';

export const DEFAULT_INVITE_MESSAGE =
  '[Your Church Name] church directory - your personal link, good for 30 days: {link}';

/** Why a template is unusable, or null if it is fine. */
export function invalidTemplateReason(t: string): string | null {
  const text = t.trim();
  if (!text) return 'The message cannot be empty.';
  if (!text.includes(INVITE_LINK_TOKEN)) {
    return `The message must contain ${INVITE_LINK_TOKEN} — that is where each person's `
         + 'private link goes. Without it they would get a text with no way in.';
  }
  // Twilio rejects very long bodies outright; well before that it is simply
  // unkind to send. Six segments is already far more than this needs.
  if (text.length > 900) return 'The message is too long. Keep it under 900 characters.';
  return null;
}

/** Substitutes the real link. Every occurrence, so repeating it is harmless. */
export function renderInvite(template: string, origin: string, token: string): string {
  return template.split(INVITE_LINK_TOKEN).join(`${origin}/directory/join/${token}`);
}
