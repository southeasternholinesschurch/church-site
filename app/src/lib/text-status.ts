/**
 * What became of a text, in words: the PURE half.
 *
 * A text's status in message_log comes from Twilio, either in the delivery
 * report it posts to the webhook or, when that report never arrives, from
 * asking Twilio directly (lib/text-status-db.ts). This file decides what each
 * status means and what each error code means, so the troubleshooting page and
 * the checker agree.
 *
 * No database, no fetch. Tested in test/text-status.test.ts.
 */

/** Statuses after which Twilio will not change its mind. */
const FINAL = new Set(['delivered', 'undelivered', 'failed', 'read', 'canceled', 'received']);

/**
 * Statuses that mean "Twilio has not finished with it yet". A text left at one
 * of these for a while is the one worth asking about. 'sent' is not here: it
 * means the carrier took it, and some carriers never send a receipt back, so a
 * text can rightly stay 'sent' for ever.
 */
export const IN_FLIGHT = ['accepted', 'scheduled', 'queued', 'sending'] as const;

export const isFinal = (status: string | null | undefined) => FINAL.has(status ?? '');
export const isFailure = (status: string | null | undefined) =>
  status === 'undelivered' || status === 'failed';

/**
 * How far along a status is. A status only ever moves FORWARD.
 *
 * Twilio posts one report per step (queued, sent, delivered) as separate
 * requests, and says plainly that they can arrive out of order. The webhook
 * used to write whatever came last, so a late "queued" landing after
 * "delivered" put the text back to "queued" for good. That fits what was found
 * on 2026-10-21: 303 texts stuck at "queued", only one ever stuck at "sent",
 * and more of them in the biggest broadcasts, where the reports arrive in a
 * crowd.
 *
 * 'unconfirmed' (the checker gave up) sits just below the real outcomes, so a
 * late real answer still replaces it.
 */
const RANK: Record<string, number> = {
  accepted: 0, scheduled: 0, queued: 1, sending: 2, sent: 3, unconfirmed: 3.5,
  delivered: 4, undelivered: 4, failed: 4, canceled: 4, read: 5,
};
export const rankOf = (status: string | null | undefined) => RANK[status ?? ''] ?? 0;

/** Whether a newly reported status should replace the one recorded. */
export const movesForward = (current: string | null | undefined, next: string) =>
  rankOf(next) >= rankOf(current) && next !== current;

/** Leave a text this long before asking about it: the report usually comes in seconds. */
export const CHECK_AFTER_MINUTES = 20;
/** Past this, a text Twilio still calls in flight is not going anywhere. */
export const GIVE_UP_HOURS = 24;

/**
 * What to record after asking Twilio about a text.
 *
 *   - Twilio has moved on: record what it says.
 *   - Twilio has no such message: 'unconfirmed', and stop asking.
 *   - Twilio still calls it in flight a day later: 'unconfirmed', and stop
 *     asking, rather than asking about the same text every five minutes.
 *   - Otherwise: null, nothing to record yet; ask again later.
 */
export function outcomeOf(
  answer: { status?: string; errorCode?: string | null; missing?: boolean },
  ageHours: number,
): { status: string; errorCode: string | null } | null {
  if (answer.missing) return { status: 'unconfirmed', errorCode: null };
  const s = answer.status ?? '';
  if (s && !(IN_FLIGHT as readonly string[]).includes(s)) return { status: s, errorCode: answer.errorCode ?? null };
  if (ageHours >= GIVE_UP_HOURS) return { status: 'unconfirmed', errorCode: answer.errorCode ?? null };
  return null;
}

/**
 * The Twilio error codes this church actually meets, in plain words with what
 * to do about each. Anything else falls back to the code and Twilio's lookup.
 */
const ERRORS: Record<string, { what: string; fix: string }> = {
  '30003': { what: 'The phone was off or out of service',
             fix: 'Usually clears up on its own. If it keeps happening, check the number with them.' },
  '30004': { what: 'The person has blocked texts from us, or from short codes',
             fix: 'Ask them whether they block texts; nothing can be done from here.' },
  '30005': { what: 'The number does not exist, or is a landline',
             fix: 'Check the number on their People page. A home phone cannot receive texts.' },
  '30006': { what: 'A landline, or a carrier that cannot receive texts',
             fix: 'Ask for a mobile number.' },
  '30007': { what: 'The carrier filtered it as possible spam',
             fix: 'Look at the wording: links and words like "free" or "win" get filtered. Retry with plainer text.' },
  '30008': { what: 'The carrier gave no reason',
             fix: 'Usually temporary. If one person keeps getting it, check the number.' },
  '30032': { what: 'The sending number is not verified',
             fix: 'A Twilio account setting: needs looking at in the Twilio console.' },
  '30034': { what: 'Our sending number is not registered with the carriers yet',
             fix: 'A Twilio account setting (A2P 10DLC): needs looking at in the Twilio console.' },
  '21610': { what: 'They replied STOP to our texts',
             fix: 'Only they can undo it, by texting START.' },
  '21211': { what: 'Not a valid phone number',
             fix: 'Correct the number on their People page.' },
  '21614': { what: 'Not a mobile number',
             fix: 'Ask for a mobile number.' },
  '30001': { what: 'Twilio was backed up and gave up on it',
             fix: 'Send it again; it should go through.' },
};

export function explainError(code: string | null | undefined): { what: string; fix: string } {
  if (!code) return { what: 'No reason was given', fix: 'Usually temporary. Send it again if it mattered.' };
  return ERRORS[code] ?? { what: `Twilio error ${code}`,
                           fix: `Look up ${code} at twilio.com/docs/api/errors.` };
}

/** A status as staff should read it. */
export function statusWords(status: string | null | undefined): string {
  switch (status) {
    case 'delivered': case 'read': return 'Delivered';
    case 'sent': return 'Sent (no receipt from the carrier)';
    case 'undelivered': return 'Not delivered';
    case 'failed': return 'Failed';
    case 'unconfirmed': return 'Unknown: Twilio never said';
    case 'accepted': case 'scheduled': case 'queued': case 'sending': return 'Waiting to hear back';
    default: return status ?? 'Unknown';
  }
}
