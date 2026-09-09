/**
 * Prayer requests on the bulletin.
 *
 * Two risks. The first is the carry-over: these columns are hand-edited JSON
 * and a broken value must degrade to an empty list rather than take down a page
 * somebody is trying to print on a Sunday morning. The second is the week
 * count, which is plain millisecond arithmetic and would be an hour out across
 * a DST change if it were not rounded — so both DST boundaries are here.
 *
 * Same plain style and no node: imports as the other tests, for the same
 * reason — this is a Workers project.
 *
 *   npm test
 */
import { parsePrayerRequests, weeksCarried, parseAnnouncements } from '../src/lib/bulletin.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

// ---- parsing ---------------------------------------------------------------
eq('parses a list', parsePrayerRequests('[{"text":"Ada Aldridge","since":"2026-09-06"}]'),
   [{ text: 'Ada Aldridge', since: '2026-09-06' }]);
eq('trims the text', parsePrayerRequests('[{"text":"  Ada  ","since":"2026-09-06"}]'),
   [{ text: 'Ada', since: '2026-09-06' }]);
// A blank line in the editor IS the removal, so it must not survive the parse.
eq('drops blank entries', parsePrayerRequests('[{"text":"   ","since":"x"},{"text":"Bob","since":"y"}]'),
   [{ text: 'Bob', since: 'y' }]);
eq('a missing since is tolerated', parsePrayerRequests('[{"text":"Ada"}]'), [{ text: 'Ada', since: '' }]);
// These three are the ones that matter: a bad value must never throw on a page
// somebody is printing.
eq('broken JSON degrades to empty', parsePrayerRequests('{not json'), []);
eq('null degrades to empty', parsePrayerRequests(null), []);
eq('a non-array degrades to empty', parsePrayerRequests('{"text":"Ada"}'), []);
eq('announcements are unaffected', parseAnnouncements('[{"heading":"Potluck"}]'),
   [{ heading: 'Potluck' }]);

// ---- how long it has been carried ------------------------------------------
eq('same week is 0', weeksCarried('2026-09-06', '2026-09-06'), 0);
eq('one week', weeksCarried('2026-09-06', '2026-09-13'), 1);
eq('six weeks', weeksCarried('2026-09-06', '2026-10-18'), 6);
// Plain ms arithmetic is an hour out across a DST change; rounding absorbs it.
// Without that these two would read 1.96 and 2.04 weeks and floor differently.
eq('across the autumn DST change', weeksCarried('2026-10-25', '2026-11-08'), 2);
eq('across the spring DST change', weeksCarried('2026-03-01', '2026-03-15'), 2);
eq('across a year boundary', weeksCarried('2026-12-27', '2027-01-10'), 2);
eq('a malformed since is 0, not NaN', weeksCarried('', '2026-09-06'), 0);
eq('a malformed service date is 0', weeksCarried('2026-09-06', 'soon'), 0);
// Never negative: a request dated after the bulletin would otherwise read "-2 weeks".
eq('a future since clamps to 0', weeksCarried('2026-10-04', '2026-09-06'), 0);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
