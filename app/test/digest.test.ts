/**
 * The Monday digest: which week it reports, whose birthday it lists, and what
 * the text says.
 *
 * The text is the part with a cost. It goes to the pastors every Monday, so a
 * quiet week should make a short text and an ordinary one should stay inside
 * two segments — and a smart apostrophe in somebody's name must not turn it
 * into UCS-2 and treble the bill, the trap the singing reminder documents.
 *
 *   npm test
 */
import { reportWeek, comingSunday, celebrationsBetween, digestText, digestKey, type DigestData } from '../src/lib/digest.ts';
import { countSegments } from '../src/lib/sms.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/* ==== which week ========================================================== */

// Monday 12 October 2026.
eq('on a Monday, last week ends yesterday', reportWeek('2026-10-12'), { start: '2026-10-05', end: '2026-10-11' });
eq('on a Thursday, it is still that week', reportWeek('2026-10-15'), { start: '2026-10-05', end: '2026-10-11' });
eq('on a Sunday, tonight has not happened yet', reportWeek('2026-10-18'), { start: '2026-10-05', end: '2026-10-11' });
eq('the coming Sunday from a Monday', comingSunday('2026-10-12'), '2026-10-18');
eq('on a Sunday it is today', comingSunday('2026-10-18'), '2026-10-18');

/* ==== the week's celebrations ============================================== */

const P = (personId: number, name: string, birthday: string | null, anniversary: string | null = null) =>
  ({ personId, name, birthday, anniversary });

{
  const people = [
    P(1, 'Ada Aldridge', '1950-10-14'),
    P(2, 'Tom Camp', '1961-10-20'),              // eight days out: not this week
    P(3, 'Erin Thorne', null, '1990-10-12'),
    P(4, 'Marguerite Stanmore', '1975-10-11'),         // yesterday: not this week
  ];
  eq('this week, in date order', celebrationsBetween(people, '2026-10-12').map((c) => [c.name, c.date, c.kind]),
     [['Erin Thorne', '2026-10-12', 'anniversary'], ['Ada Aldridge', '2026-10-14', 'birthday']]);
}
{
  // Across New Year: 29 December to 4 January.
  const c = celebrationsBetween([P(1, 'Ada Aldridge', '1950-01-02')], '2026-12-29');
  eq('a week that crosses New Year', c.map((x) => x.date), ['2027-01-02']);
}
{
  // A leap-day birthday is kept on the 28th in a common year…
  eq('29 Feb on the 28th in 2027',
     celebrationsBetween([P(1, 'Ada Aldridge', '1996-02-29')], '2027-02-25').map((x) => x.date), ['2027-02-28']);
  // …and on the day itself in a leap year, once.
  eq('and on the 29th in 2028, once',
     celebrationsBetween([P(1, 'Ada Aldridge', '1996-02-29')], '2028-02-25').map((x) => x.date), ['2028-02-29']);
}
eq('a broken date is nobody', celebrationsBetween([P(1, 'Ada Aldridge', '14/10/1950')], '2026-10-12'), []);

/* ==== the text ============================================================= */

const week = { start: '2026-10-05', end: '2026-10-11' };
const ordinary: DigestData = {
  week,
  services: [
    { kind: 'sunday-morning', label: 'Sunday Morning', date: '2026-10-11', total: 74, average: 70 },
    { kind: 'sunday-evening', label: 'Sunday Evening', date: '2026-10-11', total: 41, average: 41 },
    { kind: 'wednesday', label: 'Wednesday', date: '2026-10-07', total: 22, average: null },
  ],
  care: { guest: 2, missing: 3, reminder: 1 },
  newGuests: 2, expected: 1,
  celebrations: [
    { personId: 1, name: 'Ada', date: '2026-10-12', kind: 'birthday' },
    { personId: 2, name: 'Tom', date: '2026-10-13', kind: 'birthday' },
    { personId: 3, name: 'Erin', date: '2026-10-14', kind: 'anniversary' },
  ],
  singing: { sunday: '2026-10-18', morning: 'Tom Camp', evening: 'Ada Aldridge, Erin Thorne' },
  openSlots: 2,
};
const LINK = 'https://app.yourchurch.org/digest';

{
  const t = digestText(ordinary, LINK);
  eq('an ordinary week reads in full', t,
     'FCC week of Oct 5. Sun AM 74 (avg 70), Sun PM 41, Wed 22. Follow up: 2 guests, 3 not been in, '
     + '1 reminder. 1 planning to visit. 2 birthdays, 1 anniversary this week. Singing Sun: Tom Camp / '
     + 'Ada Aldridge, Erin Thorne. 2 sign-up slots open. https://app.yourchurch.org/digest');
  eq('and stays inside two segments', countSegments(t).segments <= 2, true);
  eq('in GSM-7', countSegments(t).encoding, 'GSM-7');
}
{
  const quiet: DigestData = { ...ordinary, services: [], care: { guest: 0, missing: 0, reminder: 0 },
    newGuests: 0, expected: 0, celebrations: [], singing: null, openSlots: 0 };
  eq('a quiet week is a short text', digestText(quiet, LINK),
     'FCC week of Oct 5. no attendance taken. https://app.yourchurch.org/digest');
}
{
  const curly = { ...ordinary, singing: { sunday: '2026-10-18', morning: 'Pat O’Brien', evening: null } };
  const t = digestText(curly, LINK);
  eq('a curly apostrophe does not make it UCS-2', countSegments(t).encoding, 'GSM-7');
  eq('an empty evening is a dash', t.includes('Singing Sun: Pat O\'Brien / -'), true);
}
eq('one digest per person per Monday', digestKey('2026-10-12', 7), 'digest:2026-10-12:7');

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
