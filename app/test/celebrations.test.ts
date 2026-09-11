/**
 * The bulletin's monthly birthdays and anniversaries.
 *
 * The date handling is the whole risk here. A bare 'YYYY-MM-DD' put through
 * new Date() is UTC midnight, which in Fairhaven renders as the evening
 * BEFORE — every birthday a day early, which nobody reports and everybody
 * notices. All twelve month boundaries are checked below for exactly that.
 *
 * Written in the same plain style as sms.test.ts, with no node: imports on
 * purpose: this is a Workers project, and pulling @types/node in to satisfy
 * a test would let Buffer and friends typecheck everywhere and fail at
 * runtime.
 *
 *   npm test
 */
import { celebrationsFor, isCelebrant, monthDay, monthOf, monthName } from '../src/lib/celebrations.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} got ${JSON.stringify(got)}${ok ? '' : `  want ${JSON.stringify(want)}`}`);
};

const P = (firstName: string, lastName: string, birthday: string | null = null,
           anniversary: string | null = null, adultChild = 'adult') =>
  ({ firstName, lastName, birthday, anniversary, adultChild });

console.log('date parsing — never through new Date()');
eq('1980-01-01 is January 1', monthDay('1980-01-01'), { month: 1, day: 1 });
eq('2005-12-31 is Dec 31',    monthDay('2005-12-31'), { month: 12, day: 31 });
eq('2005-07-04 is July 4',    monthDay('2005-07-04'), { month: 7, day: 4 });

console.log('\nrubbish in, null out');
for (const bad of [null, '', 'not a date', '1980-1-1', '1980-13-01', '1980-00-10',
                   '1980-01-32', '01/01/1980']) {
  eq(`${JSON.stringify(bad)} -> null`, monthDay(bad), null);
}

console.log('\nthe month comes from the bulletin, not from today');
eq('monthOf 2026-10-04', monthOf('2026-10-04'), 10);
eq('monthName 10', monthName(10), 'October');
eq('an October bulletin read in November still says October',
   celebrationsFor([P('Ada', 'Aldridge', '1962-10-03'), P('Tom', 'Thorne', '1958-03-11')],
                   '2026-10-04')!.birthdays.map((b) => b.name),
   ['Ada Aldridge']);

console.log('\nordering: by day, then by name for a shared day');
eq('sorted', celebrationsFor([
     P('Zoe', 'Zeller', '1990-10-20'), P('Al', 'Adams', '1990-10-05'),
     P('Bea', 'Brown', '1990-10-20'), P('Cy', 'Clark', '1990-10-01'),
   ], '2026-10-11')!.birthdays.map((b) => `${b.day} ${b.name}`),
   ['1 Cy Clark', '5 Al Adams', '20 Bea Brown', '20 Zoe Zeller']);

console.log('\nbirthdays and anniversaries are collected independently');
{
  const c = celebrationsFor([
    P('Ann', 'Ash',   '1970-10-09', '1995-06-02'),
    P('Bob', 'Birch', '1970-06-09', '1995-10-02'),
    P('Cal', 'Cedar', '1970-10-15', '1995-10-15'),
  ], '2026-10-04')!;
  eq('October birthdays',    c.birthdays.map((b) => b.name), ['Ann Ash', 'Cal Cedar']);
  eq('October anniversaries', c.anniversaries.map((b) => b.name), ['Bob Birch', 'Cal Cedar']);
}

console.log('\nempty months and missing dates');
{
  const c = celebrationsFor([P('Ann', 'Ash', '1970-10-09')], '2026-02-01')!;
  eq('February is named', c.month, 'February');
  eq('nobody in February', c.birthdays, []);
  eq('no anniversaries either', c.anniversaries, []);
}
eq('people with no dates are absent',
   celebrationsFor([P('Ann', 'Ash'), P('Bob', 'Birch')], '2026-10-04')!.birthdays, []);

console.log('\nevery month boundary resolves to its own month');
for (let m = 1; m <= 12; m++) {
  const mm = String(m).padStart(2, '0');
  const c = celebrationsFor([P('A', 'B', `1990-${mm}-01`)], `2026-${mm}-15`)!;
  eq(`${mm}-01 falls in month ${mm}`, c.birthdays.map((b) => b.day), [1]);
}

console.log('\nwho counts as a celebrant');
eq('a child belongs in the bulletin',
   isCelebrant({ archived: false, adultChild: 'child', includeInDirectory: false }), true);
eq('a directory-listed adult does',
   isCelebrant({ archived: false, adultChild: 'adult', includeInDirectory: true }), true);
eq('leaving the directory leaves the bulletin',
   isCelebrant({ archived: false, adultChild: 'adult', includeInDirectory: false }), false);
eq('archived is out regardless of age',
   isCelebrant({ archived: true, adultChild: 'child', includeInDirectory: false }), false);

console.log("\na child's anniversary is never published");
{
  const c = celebrationsFor([
    P('Kid', 'One', '2015-10-21', '2015-10-21', 'child'),
    P('Ann', 'Ash', null, '1995-10-02', 'adult'),
  ], '2026-10-04')!;
  eq('child appears under birthdays', c.birthdays.map((b) => b.name), ['Kid One']);
  eq('but not under anniversaries',   c.anniversaries.map((b) => b.name), ['Ann Ash']);
}

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
