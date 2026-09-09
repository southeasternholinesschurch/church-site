/**
 * Ages, and the class an age suggests.
 *
 * The date handling is the point. Dates in this app are 'YYYY-MM-DD' strings in
 * the church's own timezone, and `new Date('2019-07-04')` parses as UTC
 * midnight — the previous evening in Indianapolis. That bug shipped on the
 * public site once already, so ageOn does arithmetic on three integers and
 * never constructs a Date at all.
 *
 * Same plain style and no node: imports as the other tests here.
 *
 *   npm test
 */
import { ageOn, suggestClass, classMismatch } from '../src/lib/kids.ts';
import type { AgeClass } from '../src/lib/kids.ts';
import { likelyKidsKind, kindHasClasses } from '../src/lib/services.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

const CLASSES: AgeClass[] = [
  { id: 1, name: 'Ages 1-3', minAge: 1, maxAge: 3 },
  { id: 2, name: 'Ages 4-6', minAge: 4, maxAge: 6 },
  { id: 3, name: 'Ages 7-9', minAge: 7, maxAge: 9 },
  { id: 4, name: 'Ages 10-12', minAge: 10, maxAge: 12 },
  { id: 5, name: 'Ages 13-21', minAge: 13, maxAge: 21 },
];

// ---- ageOn ------------------------------------------------------------------
eq('a birthday already passed this year', ageOn('2018-03-10', '2026-09-08'), 8);
eq('a birthday still to come this year',  ageOn('2018-12-25', '2026-09-08'), 7);
// The boundary that an off-by-one gets wrong in both directions.
eq('ON their birthday they are the new age', ageOn('2018-09-08', '2026-09-08'), 8);
eq('the day before, still the old age',      ageOn('2018-09-09', '2026-09-08'), 7);
eq('the day after',                          ageOn('2018-09-07', '2026-09-08'), 8);
// A date that would shift under UTC parsing. Midnight UTC on the 1st is the
// previous evening in Indianapolis; if a Date were involved this would be 6.
eq('the first of a month does not slip a day', ageOn('2019-01-01', '2026-01-01'), 7);
eq('new year’s eve does not slip a year',      ageOn('2019-12-31', '2026-12-31'), 7);

eq('no birthday is not an age', ageOn(null, '2026-09-08'), null);
eq('empty is not an age',       ageOn('', '2026-09-08'), null);
eq('junk is not an age',        ageOn('sometime in 2019', '2026-09-08'), null);
eq('a partial date is not an age', ageOn('2019-07', '2026-09-08'), null);
eq('month 13 is not a date',    ageOn('2019-13-01', '2026-09-08'), null);
// The demo seed used to give every child a year of 1900; a 126-year-old child
// is a data problem, not an age to show on a profile.
eq('an absurd age is refused',  ageOn('1800-01-01', '2026-09-08'), null);
eq('a birthday in the future is refused', ageOn('2030-01-01', '2026-09-08'), null);

// ---- suggestClass -----------------------------------------------------------
eq('age 1 is the youngest class',  suggestClass(1, CLASSES)?.name, 'Ages 1-3');
eq('age 8 lands mid-range',        suggestClass(8, CLASSES)?.name, 'Ages 7-9');
eq('the top of a band',            suggestClass(12, CLASSES)?.name, 'Ages 10-12');
eq('the bottom of the next',       suggestClass(13, CLASSES)?.name, 'Ages 13-21');
eq('too old for any class',        suggestClass(22, CLASSES), null);
eq('too young for any class',      suggestClass(0, CLASSES), null);
eq('no age, no suggestion',        suggestClass(null, CLASSES), null);

// ---- classMismatch ----------------------------------------------------------
// Null means "nothing to say", NOT "everything is fine" — a profile must not
// show a reassuring tick for a child whose birthday nobody has.
eq('no birthday says nothing',   classMismatch(null, 3, CLASSES), null);
eq('no class says nothing',      classMismatch(8, null, CLASSES), null);
eq('age outside every class says nothing', classMismatch(30, 5, CLASSES), null);
eq('in the right class',         classMismatch(8, 3, CLASSES), false);
eq('has outgrown their class',   classMismatch(11, 3, CLASSES), true);

// ---- which [Kids Ministry] service a day implies ------------------------------------
// The noon-UTC trick again: parsing these as midnight UTC puts them on the
// previous evening in Indianapolis and names the wrong day of the week.
eq('a Sunday means the Sunday classes',   likelyKidsKind('2026-09-06'), 'kids-sunday');
eq('a Wednesday means the club',          likelyKidsKind('2026-09-09'), 'kids-wednesday');
eq('a Saturday means neither',            likelyKidsKind('2026-09-05'), null);
eq('a Monday means neither',              likelyKidsKind('2026-09-07'), null);
// New year's day 2026 is a Thursday; the day before is a Wednesday. A UTC-
// midnight parse would shift both.
eq('new year’s day is a Thursday',        likelyKidsKind('2026-01-01'), null);
eq('the eve of it is a Wednesday',        likelyKidsKind('2025-12-31'), 'kids-wednesday');

eq('the Wednesday club has no classes',   kindHasClasses('kids-wednesday'), false);
eq('the Sunday classes do',               kindHasClasses('kids-sunday'), true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
