/**
 * Pastoral care: who is on the follow-up list, and what a guest card may say.
 *
 * The decisions worth a test are the ones that would be wrong QUIETLY:
 *
 *   - a regular who moved from the morning to the evening service is not
 *     "missing", and a Sunday nobody took the register is not an absence for
 *     the whole church;
 *   - a guest card is forgiving to a person and silent to a bot;
 *   - the pages are admin-only, the card endpoint is public, and the redirect
 *     back to the website can only ever go to the website.
 *
 *   npm test
 */
import {
  weekOf, dayOf, findMissing, missingKey, parseMissingKey, missingReason, nextDate, readGuestCard,
  guestReason, guestAlertBody, gsmSafe, sortQueue, parseWants, wantsText, parseIdList, addDays,
  type Presence,
} from '../src/lib/care.ts';
import { countSegments } from '../src/lib/sms.ts';
import { isPublicPath, siteOriginFor } from '../src/lib/public-paths.ts';
import { canAccess } from '../src/lib/permissions.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/* ==== weeks run Sunday to Saturday ======================================= */

eq('a Sunday is its own week', weekOf('2026-10-11'), '2026-10-11');
eq('Wednesday night belongs to the Sunday before it', weekOf('2026-10-14'), '2026-10-11');
eq('Saturday too', weekOf('2026-10-17'), '2026-10-11');
eq('across a month end', weekOf('2026-10-01'), '2026-09-27');

// A card filled in at 9:30pm on a Sunday is stored as 01:30 MONDAY in UTC. It
// was filled in on Sunday, and that is the day the list must say.
eq('a Sunday-night card is a Sunday card', dayOf('2026-10-12T01:30:00.000Z'), '2026-10-11');
eq('SQLite timestamps are UTC as well', dayOf('2026-10-12 01:30:00'), '2026-10-11');
eq('a morning one is the same day', dayOf('2026-10-11T15:00:00.000Z'), '2026-10-11');

/* ==== who has stopped coming ============================================= */

// Twelve Sundays, oldest first: Jul 26 … Oct 11. The last four are Sep 20 – Oct 11.
const sundays = Array.from({ length: 12 }, (_, i) => addDays('2026-07-26', i * 7));
const recent = sundays.slice(8);
const prior = sundays.slice(0, 8);
const at = (personId: number, dates: string[]): Presence[] => dates.map((date) => ({ personId, date }));

{
  const presence = [
    // 1: came 7 of the 8 weeks before, nothing since — the person this is for.
    ...at(1, prior.slice(1)),
    // 2: just as faithful, and still here.
    ...at(2, sundays),
    // 3: came twice — not a regular, so not "missing".
    ...at(3, prior.slice(0, 2)),
    // 4: a regular who MOVED TO THE EVENING service — same weeks, different
    //    service, so absent from no week at all.
    ...at(4, prior),
    ...at(4, recent.map((d) => d)),
    // 5: a regular whose only recent visits were WEDNESDAYS. Wednesday belongs
    //    to the week, so they have been coming.
    ...at(5, prior),
    ...at(5, [addDays(recent[2]!, 3)]),
    // 6: exactly three of the prior weeks — the threshold, so included.
    ...at(6, prior.slice(2, 5)),
  ];
  const dates = [...sundays, addDays(recent[2]!, 3)];
  const missing = findMissing(dates, presence);
  eq('only the regulars who stopped are listed', missing.map((m) => m.personId), [1, 6]);
  const one = missing.find((m) => m.personId === 1)!;
  eq('last seen is their last service', one.lastSeen, prior[7]);
  eq('weeks before is counted in weeks', one.weeksBefore, 7);
  eq('and the reason says so plainly', missingReason(one),
     'Last here Sun, Sep 13 · came 7 of the 8 weeks before');
  eq('weeks away counts service weeks since', one.weeksAway, 4);
}

{
  // A SUNDAY WITH NO REGISTER IS NOT AN ABSENCE. Week 10 has no service row
  // with anybody ticked, so it is not in the dates at all — and someone who
  // came every other week of the twelve is not missing because of it.
  const gap = sundays[9]!;
  const dates = sundays.filter((d) => d !== gap);
  const presence = at(1, dates);
  eq('an unrecorded week is not counted against anybody', findMissing(dates, presence), []);
}

{
  // NOT ENOUGH HISTORY. Three weeks of registers cannot say who has stopped,
  // and without this the first month would list everybody who missed one.
  eq('too little history says nothing', findMissing(sundays.slice(0, 3), at(1, sundays.slice(0, 1))), []);
}

eq('the key carries the last date seen', missingKey(12, '2026-09-07'), 'missing:12:2026-09-07');
eq('and reads back', parseMissingKey('missing:12:2026-09-07'), { personId: 12, lastSeen: '2026-09-07' });
eq('a guest key is not a missing key', parseMissingKey('guest:4'), null);

/* ==== what next ========================================================== */

const TODAY = '2026-10-12';
eq('done means no reminder', nextDate(TODAY, 'done'), null);
eq('a week', nextDate(TODAY, 'week'), '2026-10-19');
eq('two weeks', nextDate(TODAY, 'fortnight'), '2026-10-26');
eq('four weeks lands on the same weekday', nextDate(TODAY, 'month'), '2026-11-09');
eq('a chosen date', nextDate(TODAY, 'date', '2026-12-01'), '2026-12-01');
eq('a chosen date in the past is not a reminder', nextDate(TODAY, 'date', '2026-10-01'), null);
eq('nor is today', nextDate(TODAY, 'date', TODAY), null);
eq('nor is nonsense', nextDate(TODAY, 'date', 'tomorrow'), null);
eq('an unknown step is nothing', nextDate(TODAY, 'someday'), null);

/* ==== the list's order =================================================== */

{
  const items = [
    { id: 1, kind: 'missing', dueOn: '2026-10-01', createdAt: 'a' },
    { id: 2, kind: 'reminder', dueOn: '2026-10-12', createdAt: 'b' },
    { id: 3, kind: 'guest', dueOn: '2026-10-12', createdAt: 'c' },
    { id: 4, kind: 'guest', dueOn: '2026-10-11', createdAt: 'd' },
  ];
  eq('guests first, then reminders, then absences', sortQueue(items).map((i) => i.id), [4, 3, 2, 1]);
}

/* ==== guest cards ======================================================== */

const card = (f: Parameters<typeof readGuestCard>[0]) => readGuestCard(f, TODAY);

eq('a first name is enough', card({ first: 'Jane' }).ok, true);
eq('no name is sent back', card({ first: '  ' }), { ok: false, problem: 'name' });
eq('THE HONEYPOT is spam', card({ first: 'Jane', website: 'x' }), { ok: false, problem: 'spam' });
eq('a link in the message is spam', card({ first: 'Jane', message: 'see https://x.example' }), { ok: false, problem: 'spam' });
eq('a link as a name is spam', card({ first: 'www.cheap.example' }), { ok: false, problem: 'spam' });
eq('a bad email is sent back', card({ first: 'Jane', email: 'jane@' }), { ok: false, problem: 'email' });
eq('a bad phone is sent back', card({ first: 'Jane', phone: '12' }), { ok: false, problem: 'phone' });
eq('asking for a visit with no way to be reached is sent back',
   card({ first: 'Jane', wants: ['visit'] }), { ok: false, problem: 'contact' });
eq('asking for kids info alone needs no contact', card({ first: 'Jane', wants: ['kids'] }).ok, true);

{
  const r = card({ first: ' Jane ', last: 'Doe', phone: '(317) 555-0142', email: 'JANE@Example.org',
                   wants: ['visit', 'nonsense', 'visit'], firstTime: true, sms: true });
  if (!r.ok) { fail++; console.error('FAIL a full card reads'); }
  else {
    eq('names are trimmed', r.card.firstName, 'Jane');
    eq('the number is made textable', r.card.phoneE164, '+13175550142');
    eq('email is lower-cased', r.card.email, 'jane@example.org');
    eq('unknown and repeated requests are dropped', r.card.wants, ['visit']);
    eq('the tick-box with a number is consent', r.card.smsConsent, 'opted_in');
    eq('a card at church is dated today', r.card.visitDate, TODAY);
    eq('the reason reads well', guestReason(r.card), 'Visited Mon, Oct 12 · first time · wants a visit');
    const alert = guestAlertBody(r.card, 'https://app.yourchurch.org/care/guest/7');
    eq('the alert names them', alert,
       'New guest card: Jane Doe (first time) - wants a visit. https://app.yourchurch.org/care/guest/7');
    eq('the alert is plain GSM-7', countSegments(alert).encoding, 'GSM-7');
    eq('and one segment', countSegments(alert).segments, 1);
  }
}

{
  const r = card({ first: 'Jane', sms: true });
  eq('the tick-box without a number is nothing', r.ok && r.card.smsConsent, null);
}

{
  const r = card({ first: 'Sam', kind: 'planning', visitDate: '2026-10-18', party: 'Two of us and a 6-year-old' });
  eq('a planned visit keeps its date', r.ok && r.card.visitDate, '2026-10-18');
  eq('and says so', r.ok && guestReason(r.card), 'Planning to visit Sun, Oct 18');
  eq('not sure yet is a real answer', card({ first: 'Sam', kind: 'planning' }).ok && true, true);
  eq('a planned date in the past is sent back',
     card({ first: 'Sam', kind: 'planning', visitDate: '2026-10-01' }), { ok: false, problem: 'date' });
  eq('a year out is a slip of the thumb',
     card({ first: 'Sam', kind: 'planning', visitDate: '2027-10-18' }), { ok: false, problem: 'date' });
}

eq('a curly apostrophe is straightened', gsmSafe('O’Brien — “hi”'), `O'Brien - "hi"`);
{
  const alert = guestAlertBody({ firstName: 'Sean', lastName: 'O’Brien', kind: 'here',
    visitDate: TODAY, firstTime: false, wants: [] }, 'https://x.example/c');
  eq('an iPhone apostrophe does not triple the cost', countSegments(alert).encoding, 'GSM-7');
}
eq('wants read back from storage', parseWants('["call","kids","bogus"]'), ['call', 'kids']);
eq('a broken value is nothing', parseWants('{oops'), []);
eq('two requests read as a phrase', wantsText(['visit', 'call']), 'a visit and a call');
eq('recipient ids: junk is dropped', parseIdList('[3,"4",0,-1,3,"x"]'), [3, 4]);
eq('recipient ids: broken is nobody', parseIdList('not json'), []);

/* ==== who reaches what =================================================== */

eq('the card endpoint is public', isPublicPath('/api/guest-card'), true);
eq('Care is not', isPublicPath('/care'), false);
eq('nor a guest card page', isPublicPath('/care/guest/1'), false);
eq('nor the digest', isPublicPath('/digest'), false);

eq('an admin reaches Care', canAccess('admin', '/care'), true);
eq('an admin reaches a person', canAccess('admin', '/care/person/4'), true);
eq('AN ATTENDANCE VOLUNTEER DOES NOT', canAccess('editor', '/care'), false);
eq('not by a deep link either', canAccess('editor', '/care/person/4'), false);
eq('nor the digest', canAccess('editor', '/digest'), false);
eq('nor an Fairhaven Kids volunteer', canAccess('kids', '/care'), false);
eq('but People is still theirs', canAccess('editor', '/people/4'), true);

/* ==== the way back to the website ======================================== */

eq('back to where the card came from', siteOriginFor('https://www.yourchurch.org', null),
   'https://www.yourchurch.org');
eq('NEVER somewhere else', siteOriginFor('https://evil.example', null), 'https://yourchurch.org');
eq('the referer is used when there is no origin',
   siteOriginFor(null, 'http://localhost:4321/welcome/'), 'http://localhost:4321');
eq('a garbage referer goes home', siteOriginFor(null, 'not a url'), 'https://yourchurch.org');
eq('an opaque origin goes home', siteOriginFor('null', null), 'https://yourchurch.org');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
