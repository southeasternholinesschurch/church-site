/**
 * The singing schedule, kept in the app instead of a Google Sheet.
 *
 * The thing that must not change is how a Sunday is READ. The bulletin and the
 * Monday reminder used to get their answer from the sheet; now they may get it
 * from the app's own table — and the same cell must mean the same thing either
 * way. So the first block here puts one schedule through both paths and asks
 * for the same answer.
 *
 * Then the planning tools: quarters, the Sundays in them, what the editor tells
 * you about each name, and what a printed row looks like.
 *
 *   npm test
 */
import {
  parseRosterDetailed, rosterFromRows, flattenRoster, parseRoster, singersFor, matchPeople,
} from '../src/lib/roster.ts';
import {
  quarterOf, quarterFromKey, shiftQuarter, sundaysBetween, cellNames, singerTally, printRow,
  rowsFromSheet,
} from '../src/lib/singing.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/* ==== the sheet and the app read a Sunday the same way =================== */

const SHEET = `Sunday,AM,PM
2026-10-04,Tom Camp,Ruth Stanmore
2026-10-11,"Ada Aldridge, Erin Thorne",Youth-led Service
2026-10-25,Family Day,
`;
const ROWS = [
  // Out of order on purpose: the table is not read in insertion order.
  { sunday: '2026-10-25', morning: 'Family Day', evening: null },
  { sunday: '2026-10-04', morning: 'Tom Camp', evening: 'Ruth Stanmore' },
  { sunday: '2026-10-11', morning: 'Ada Aldridge, Erin Thorne', evening: 'Youth-led Service' },
];

eq('THE SAME SCHEDULE READS THE SAME FROM EITHER PLACE',
   rosterFromRows(ROWS), parseRosterDetailed(SHEET));
eq('so the Monday reminder sees the same names',
   flattenRoster(rosterFromRows(ROWS)), parseRoster(SHEET));
eq('and the bulletin the same Sunday',
   singersFor(rosterFromRows(ROWS), '2026-10-11'), singersFor(parseRosterDetailed(SHEET), '2026-10-11'));
eq('a Sunday with nothing in it is not a Sunday',
   rosterFromRows([{ sunday: '2026-11-01', morning: '  ', evening: null }]), []);
eq('a row with a broken date is dropped',
   rosterFromRows([{ sunday: 'next week', morning: 'Tom Camp', evening: null }]), []);

/* ==== copying the sheet in =============================================== */

{
  /*
   * A sheet in the shapes the church's real one uses: one singer, a couple, a
   * group of four, a note where the names go, and a Sunday with the evening
   * left blank. Copied in and read back, it must say what it said before,
   * Sunday by Sunday — or the day the schedule moves is the day the bulletin
   * quietly changes. (Invented names; the real schedule is data, not a fixture.)
   */
  const csv = `Sunday,AM,PM
2026-07-19,Ada Aldridge,Tom Camp
2026-08-02,Erin Thorne,VBS Finale Service
2026-08-09,"Peter Kingsley, Ada Aldridge",Youth Led Service
2026-08-16,"Tom Camp, Erin Thorne, Ada Aldridge, Marguerite Stanmore",Ruth Stanmore
2026-09-27,Fall Revival,
`;
  const rows = rowsFromSheet(csv);
  eq('every Sunday with anything on it is copied', rows.length, parseRosterDetailed(csv).length);
  eq('AND READS BACK EXACTLY AS THE SHEET DID', rosterFromRows(rows), parseRosterDetailed(csv));
  eq('a group stays one cell', rows.find((r) => r.sunday === '2026-08-16')?.morning,
     'Tom Camp, Erin Thorne, Ada Aldridge, Marguerite Stanmore');
  eq('a note stays a note', rows.find((r) => r.sunday === '2026-09-27'),
     { sunday: '2026-09-27', morning: 'Fall Revival', evening: null });
}

/* ==== quarters =========================================================== */

eq('October is in the fourth quarter', quarterOf('2026-10-10').key, '2026-Q4');
eq('which runs October to December', [quarterOf('2026-10-10').start, quarterOf('2026-10-10').end],
   ['2026-10-01', '2026-12-31']);
eq('and prints as months', quarterOf('2026-10-10').label, 'October – December 2026');
eq('a key reads back', quarterFromKey('2027-Q1')?.label, 'January – March 2027');
eq('nonsense is no quarter', quarterFromKey('2027-Q5'), null);
eq('the next quarter crosses a year', shiftQuarter(quarterOf('2026-11-01'), 1).key, '2027-Q1');
eq('and the one before does too', shiftQuarter(quarterOf('2027-02-01'), -1).key, '2026-Q4');
eq('February ends where it should in a leap year', quarterOf('2028-02-10').end, '2028-03-31');

eq('the Sundays of a quarter', sundaysBetween('2026-10-01', '2026-12-31').length, 13);
eq('starting on the first one', sundaysBetween('2026-10-01', '2026-12-31')[0], '2026-10-04');
eq('a quarter that starts on a Sunday has fourteen', sundaysBetween('2029-07-01', '2029-09-30').length, 14);
eq('backwards is nothing', sundaysBetween('2026-12-31', '2026-10-01'), []);

/* ==== what the editor says about each name =============================== */

const PEOPLE = [
  { id: 1, firstName: 'Tom', lastName: 'Camp', phoneE164: '+13175550101', smsConsent: 'opted_in' },
  { id: 2, firstName: 'Ruth', lastName: 'Stanmore', phoneE164: null, smsConsent: 'opted_in' },
  { id: 3, firstName: 'Erin', lastName: 'Thorne', phoneE164: '+13175550103', smsConsent: 'unknown' },
  { id: 4, firstName: 'Sam', lastName: 'Aldridge', phoneE164: '+13175550104', smsConsent: 'opted_in' },
  { id: 5, firstName: 'Sam', lastName: 'Aldridge', phoneE164: '+13175550105', smsConsent: 'opted_in' },
];

eq('a singer who will be reminded', cellNames('Tom Camp', PEOPLE),
   [{ text: 'Tom Camp', state: 'reminded' }]);
eq('one with no number is found but quiet', cellNames('Ruth Stanmore', PEOPLE),
   [{ text: 'Ruth Stanmore', state: 'quiet', reason: 'no phone number on file' }]);
eq('one not opted in is quiet too', cellNames('Erin Thorne', PEOPLE)[0]?.state, 'quiet');
eq('a guest singer is not on People', cellNames('The Carver Sisters', PEOPLE)[0]?.state, 'unknown');
eq('two people with one name cannot be guessed between', cellNames('Sam Aldridge', PEOPLE)[0]?.state, 'unknown');
eq('several names, each judged', cellNames('Tom Camp, Ruth Stanmore', PEOPLE).map((n) => n.state),
   ['reminded', 'quiet']);
eq('a note is a note', cellNames('Fall Revival', PEOPLE), [{ text: 'Fall Revival', state: 'note' }]);
eq('an empty cell says nothing', cellNames('', PEOPLE), []);
eq('the editor and the reminder use one rule',
   matchPeople(['Tom Camp'], PEOPLE).matched.map((m) => m.personId), [1]);

/* ==== who has sung lately ================================================= */

{
  const t = singerTally([
    { sunday: '2026-09-06', morning: 'Tom Camp', evening: 'Ruth Stanmore' },
    { sunday: '2026-10-04', morning: 'tom camp', evening: 'Revival' },
    { sunday: '2027-01-03', morning: 'Erin Thorne', evening: null },
  ], '2026-01-01', '2026-12-31');
  eq('counted case-insensitively, inside the window', t.map((x) => [x.name, x.times, x.last]),
     [['Tom Camp', 2, '2026-10-04'], ['Ruth Stanmore', 1, '2026-09-06']]);
}

/* ==== the printed row ===================================================== */

eq('a note alone spans the day', printRow({ sunday: '2026-10-25', morning: 'Fall Revival', evening: null }),
   { sunday: '2026-10-25', span: 'Fall Revival' });
eq('a note beside singers stays in its column',
   printRow({ sunday: '2026-10-11', morning: 'Ada Aldridge, Erin Thorne', evening: 'Youth-led Service' }),
   { sunday: '2026-10-11', morning: { text: 'Ada Aldridge, Erin Thorne', note: false },
     evening: { text: 'Youth-led Service', note: true } });
eq('an empty cell prints as empty, not as a missing row',
   printRow({ sunday: '2026-11-01', morning: 'Tom Camp', evening: null }),
   { sunday: '2026-11-01', morning: { text: 'Tom Camp', note: false }, evening: null });

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
