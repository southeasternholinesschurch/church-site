/**
 * What became of a text.
 *
 * Two risks carry the weight here. The first is a status going BACKWARDS:
 * Twilio's reports can arrive out of order, and writing whatever came last left
 * 303 delivered-or-not texts stuck at "queued" (found 2026-10-21). The second is
 * the checker asking about the same text for ever, spending the cron's outbound
 * calls on it every five minutes.
 *
 *   npm test
 */
import { explainError, isFinal, movesForward, outcomeOf, statusWords, GIVE_UP_HOURS } from '../src/lib/text-status.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

/* ==== never backwards ==================================================== */

eq('queued then sent moves on', movesForward('queued', 'sent'), true);
eq('sent then delivered moves on', movesForward('sent', 'delivered'), true);
eq('a late "queued" after "delivered" is ignored', movesForward('delivered', 'queued'), false);
eq('a late "sent" after "delivered" is ignored', movesForward('delivered', 'sent'), false);
eq('a late "sent" after "undelivered" is ignored', movesForward('undelivered', 'sent'), false);
eq('the same status again changes nothing', movesForward('delivered', 'delivered'), false);
eq('a real answer replaces "unconfirmed"', movesForward('unconfirmed', 'delivered'), true);
eq('a late "queued" does not replace "unconfirmed"', movesForward('unconfirmed', 'queued'), false);
eq('an unknown current status can be replaced', movesForward(null, 'queued'), true);

/* ==== the checker settles or lets go ===================================== */

eq('Twilio says delivered: record it', outcomeOf({ status: 'delivered' }, 2), { status: 'delivered', errorCode: null });
eq('Twilio says undelivered: record it with the code',
   outcomeOf({ status: 'undelivered', errorCode: '30005' }, 2), { status: 'undelivered', errorCode: '30005' });
eq('Twilio says sent: record it, and stop asking', outcomeOf({ status: 'sent' }, 2), { status: 'sent', errorCode: null });
eq('still queued, recently: ask again later', outcomeOf({ status: 'queued' }, 1), null);
eq('still queued after a day: give up as unconfirmed',
   outcomeOf({ status: 'queued' }, GIVE_UP_HOURS + 1), { status: 'unconfirmed', errorCode: null });
eq('Twilio has no such message: unconfirmed', outcomeOf({ missing: true }, 1), { status: 'unconfirmed', errorCode: null });

/* ==== words ============================================================== */

eq('delivered is final', isFinal('delivered'), true);
eq('queued is not', isFinal('queued'), false);
eq('a known code is explained', explainError('30005').what.includes('landline'), true);
eq('an unknown code still says something', explainError('39999').what, 'Twilio error 39999');
eq('no code still says something', explainError(null).what.length > 0, true);
eq('a status reads as words', statusWords('unconfirmed').startsWith('Unknown'), true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
