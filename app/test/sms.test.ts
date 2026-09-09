/**
 * Segment counting and phone normalisation, checked against known values.
 *
 * Every number here is from the 555-01xx range reserved for fiction, and every
 * name is invented. This file used to carry a real member's phone number as a
 * normalisation fixture, in a public repository. A test needs a well-formed
 * number, not a real one.
 *
 * These are pure functions that look obviously right and are easy to get
 * wrong, and both have consequences: a bad segment count misreports the cost
 * of every send, and a bad normalisation means a real person silently never
 * receives anything.
 *
 *   npm test
 */
import { toE164, countSegments } from '../src/lib/sms.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`);
};

console.log('phone normalisation');
eq('(317) 555-0142',        toE164('(317) 555-0142'), '+13175550142');
eq('317-555-0142',          toE164('317-555-0142'),   '+13175550142');
eq('13175550142',           toE164('13175550142'),    '+13175550142');
eq('+13175550142',          toE164('+13175550142'),   '+13175550142');
eq('already E.164 non-US',  toE164('+447700900123'),  '+447700900123');
eq('too short -> null',     toE164('555-0142'),       null);
eq('junk -> null',          toE164('not a phone'),    null);
eq('empty -> null',         toE164(''),               null);
eq('null -> null',          toE164(null),             null);

console.log('\nsegments (GSM-7)');
eq('1 char',        countSegments('a').segments, 1);
eq('exactly 160',   countSegments('a'.repeat(160)).segments, 1);
eq('161 -> 2',      countSegments('a'.repeat(161)).segments, 2);
eq('exactly 306',   countSegments('a'.repeat(306)).segments, 2);
eq('307 -> 3',      countSegments('a'.repeat(307)).segments, 3);
eq('encoding',      countSegments('Hello church').encoding, 'GSM-7');
eq('newline is GSM', countSegments('a\nb').encoding, 'GSM-7');

console.log('\nsegments (extended GSM costs 2)');
eq('79 a + { = 1 seg',  countSegments('a'.repeat(158) + '{').segments, 1);
eq('159 a + { -> 2',    countSegments('a'.repeat(159) + '{').segments, 2);

console.log('\nsegments (UCS-2)');
eq('emoji forces UCS-2', countSegments('Hi 👋').encoding, 'UCS-2');
eq('é is GSM-7, not unicode', countSegments('é'.repeat(200)).encoding, 'GSM-7');
// The one that actually bites: a curly apostrophe from Word or Notes is NOT
// GSM-7, so pasting a message silently halves the per-segment budget.
eq('curly apostrophe forces UCS-2', countSegments("Don’t forget").encoding, 'UCS-2');
eq('70 unicode = 1',     countSegments('’'.repeat(70)).segments, 1);
eq('71 unicode -> 2',    countSegments('’'.repeat(71)).segments, 2);
eq('straight apostrophe stays GSM', countSegments("Don't forget").encoding, 'GSM-7');
eq('emoji counts 2 units', countSegments('👋'.repeat(35)).segments, 1);
eq('36 emoji -> 2',      countSegments('👋'.repeat(36)).segments, 2);

console.log('\nremaining');
eq('empty leaves 160',   countSegments('').remainingInSegment, 160);
eq('150 leaves 10',      countSegments('a'.repeat(150)).remainingInSegment, 10);

// --- Twilio webhook signature -------------------------------------------
// The expected value below is NOT taken from memory — an earlier attempt used
// a misremembered constant and failed, which looked like a broken validator
// and was a broken test. It is computed independently with Python's hmac
// module over Twilio's documented algorithm (URL, then each parameter as key
// immediately followed by value, sorted by key, HMAC-SHA1, base64). Two
// implementations agreeing on the same input is the actual evidence.
//
// Getting the sort order, the concatenation or the URL handling subtly wrong
// produces a validator that rejects everything (loud) or accepts everything
// (silent, and much worse).
import { isValidTwilioSignature, isStopKeyword, isStartKeyword } from '../src/lib/twilio-signature.ts';

console.log('\nTwilio signature (official test vector)');
{
  const url = 'https://mycompany.com/myapp.php?foo=1&bar=2';
  const params = {
    CallSid: 'CA1234567890ABCDE', Caller: '+14158675309', Digits: '1234',
    From: '+14158675309', To: '+18005551212',
  };
  const token = '12345';
  const expected = 'RSOYDt4T1cUTdK1PDd93/VVr8B8=';   // python: hmac-sha1, base64

  eq('accepts the documented signature',
     await isValidTwilioSignature(token, url, params, expected), true);
  eq('rejects a tampered signature',
     await isValidTwilioSignature(token, url, params, 'AAAAAt4T1cUTdK1PDd93/VVr8B8='), false);
  eq('rejects a wrong auth token',
     await isValidTwilioSignature('54321', url, params, expected), false);
  eq('rejects an altered parameter',
     await isValidTwilioSignature(token, url, { ...params, Digits: '9999' }, expected), false);
  eq('rejects a different URL',
     await isValidTwilioSignature(token, 'https://evil.example/myapp.php', params, expected), false);
  eq('rejects an empty signature',
     await isValidTwilioSignature(token, url, params, ''), false);
  eq('rejects when no auth token is set',
     await isValidTwilioSignature('', url, params, expected), false);
}

console.log('\nopt-out keywords');
eq('STOP',        isStopKeyword('STOP'), true);
eq('stop lower',  isStopKeyword('stop'), true);
eq('  Stop.  ',   isStopKeyword('  Stop.  '), true);
eq('UNSUBSCRIBE', isStopKeyword('UNSUBSCRIBE'), true);
eq('QUIT',        isStopKeyword('QUIT'), true);
eq('not a stop',  isStopKeyword('stop by the office'), false);
eq('START',       isStartKeyword('START'), true);
eq('YES',         isStartKeyword('yes'), true);
eq('JOIN',        isStartKeyword('JOIN'), true);
eq('join lower',  isStartKeyword('join'), true);
eq('not a start', isStartKeyword('yes please'), false);



// --- singing roster ------------------------------------------------------
import { parseRoster, parseSheetDate, dueSunday, SINGING_REMINDER } from '../src/lib/roster.ts';
import { countSegments as seg } from '../src/lib/sms.ts';

console.log('\nroster sheet parsing');
{
  const csv = [
    'Sunday,AM,PM',
    '2026-09-06,"Ada Aldridge, Tom Aldridge",Peter Kingsley',
    '9/13/2026,Nora Kingsley,',
    ',,',
    '2026-09-20,Felicity Stanmore;Lucas Colegate,',
  ].join('\n');
  const r = parseRoster(csv);
  eq('rows found (header and blank skipped)', r.length, 3);
  eq('splits names in one cell', r[0].names, ['Ada Aldridge', 'Tom Aldridge', 'Peter Kingsley']);
  eq('accepts US date format', r[1].sunday, '2026-09-13');
  eq('semicolons split too', r[2].names, ['Felicity Stanmore', 'Lucas Colegate']);
}

console.log('\ndate formats staff might type');
eq('ISO',        parseSheetDate('2026-09-06'), '2026-09-06');
eq('US slashes', parseSheetDate('9/6/2026'),   '2026-09-06');
eq('2-digit yr', parseSheetDate('09/06/26'),   '2026-09-06');
eq('header text',parseSheetDate('Sunday'),      null);

console.log('\nwhen the reminder fires (church timezone, not UTC)');
// Indianapolis is UTC-4 in September. Mon 2026-09-07 09:00 local = 13:00 UTC.
eq('Mon 9am local -> due',        dueSunday(new Date('2026-09-07T13:00:00Z')), { sunday: '2026-09-13', late: false });
eq('Mon 8am local -> too early',  dueSunday(new Date('2026-09-07T12:00:00Z')), null);
eq('Mon 11pm local -> still due', dueSunday(new Date('2026-09-08T03:00:00Z')), { sunday: '2026-09-13', late: false });
// THE TRAP: 02:00 UTC Monday is 22:00 SUNDAY in Indianapolis. Must not fire.
eq('Sun 10pm local (Mon in UTC)', dueSunday(new Date('2026-09-07T02:00:00Z')), null);
eq('Tue 9am local -> late grace', dueSunday(new Date('2026-09-08T13:00:00Z')), { sunday: '2026-09-13', late: true });
eq('Wed -> not sent',             dueSunday(new Date('2026-09-09T13:00:00Z')), null);
eq('Sat -> not sent',             dueSunday(new Date('2026-09-12T13:00:00Z')), null);

console.log('\nthe reminder message');
eq('one segment',  seg(SINGING_REMINDER).segments, 1);
eq('plain GSM-7',  seg(SINGING_REMINDER).encoding, 'GSM-7');
eq('names church', SINGING_REMINDER.includes('[Your Church Name]'), true);



console.log('\nSundays with no singers');
import { looksLikeNote } from '../src/lib/roster.ts';
for (const n of ['Revival', 'revival', 'Fall Revival', 'No service', 'No singing',
                 'Cancelled', 'TBA', 'TBD', 'None', 'N/A', '-', 'Guest speaker',
                 'Missions service', 'Communion', 'Christmas program', 'Homecoming',
                 // the exact strings in the pastor's published schedule
                 'VBS Finale Service', 'Youth Led Service', 'Youth-led Service',
                 'Bring-your-Favorite-Chorus', 'Family Day', 'Fall Revival']) {
  eq(`"${n}" is a note`, looksLikeNote(n), true);
}
console.log('  …and real names must NOT be mistaken for notes:');
for (const n of ['Ada Aldridge', 'Peter Kingsley', 'Nora Kingsley', 'Felicity Stanmore',
                 'Lucas Colegate', 'Faith Campbell', 'Christian Moore', 'Grace Camp',
                 'Sarah Guest', 'Mark Cancella', 'Joy Church', 'Hope Chapel']) {
  eq(`"${n}" is a name`, looksLikeNote(n), false);
}

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
