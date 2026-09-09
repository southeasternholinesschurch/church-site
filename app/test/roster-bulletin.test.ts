/**
 * Splitting the singing schedule into morning and evening for the bulletin.
 *
 * The risk is that the sheet is typed by a person, so the shape is not
 * guaranteed: headers may be "AM"/"PM" or "Morning"/"Evening" or missing
 * entirely, a cell may hold a note instead of names, and a Sunday may have
 * only one service. All of those are real weeks, so all of them are here.
 *
 * The flat parseRoster is tested too, because the Monday reminder still runs
 * through it and must not have changed behaviour.
 *
 *   npm test
 */
import {
  parseRosterDetailed, parseRoster, singersFor, addDays,
} from '../src/lib/roster.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

const AMPM = `Sunday,AM,PM
2026-09-06,"Ada Aldridge, Tom Aldridge",Peter Kingsley
2026-09-13,Marguerite Ashdown,"Harold Beckwith, Nora Kingsley"
`;

// ---- columns are kept apart -----------------------------------------------
{
  const days = parseRosterDetailed(AMPM);
  eq('two Sundays parsed', days.length, 2);
  eq('AM header becomes Morning', days[0].slots[0].label, 'Morning');
  eq('PM header becomes Evening', days[0].slots[1].label, 'Evening');
  eq('morning names', days[0].slots[0].names, ['Ada Aldridge', 'Tom Aldridge']);
  eq('evening names', days[0].slots[1].names, ['Peter Kingsley']);
}

// Spelled-out headers, and a sheet with a title row above the real header.
{
  const days = parseRosterDetailed(`Singing Schedule 2026,,
Sunday,Morning,Evening
2026-09-06,Ada Aldridge,Peter Kingsley
`);
  eq('title row above the header is skipped', days.length, 1);
  eq('spelled-out morning header', days[0].slots[0].label, 'Morning');
  eq('spelled-out evening header', days[0].slots[1].label, 'Evening');
}

// No header row at all — position decides.
{
  const days = parseRosterDetailed(`2026-09-06,Ada Aldridge,Peter Kingsley\n`);
  eq('headerless first column is Morning', days[0].slots[0].label, 'Morning');
  eq('headerless second column is Evening', days[0].slots[1].label, 'Evening');
}

// An unusual header is kept as written rather than forced into a guess.
{
  const days = parseRosterDetailed(`Sunday,Special\n2026-09-06,Ada Aldridge\n`);
  eq('unknown header kept verbatim', days[0].slots[0].label, 'Special');
}

// ---- notes are not people --------------------------------------------------
{
  const days = parseRosterDetailed(`Sunday,AM,PM\n2026-09-06,Ada Aldridge,Revival\n`);
  eq('a note yields no names', days[0].slots[1].names, []);
  eq('a note is kept for printing', days[0].slots[1].note, 'Revival');
  eq('the real names beside it still parse', days[0].slots[0].names, ['Ada Aldridge']);
}

// One service only — an empty cell must not become an empty slot.
{
  const days = parseRosterDetailed(`Sunday,AM,PM\n2026-09-06,Ada Aldridge,\n`);
  eq('empty cell is dropped', days[0].slots.length, 1);
  eq('the remaining slot is the morning', days[0].slots[0].label, 'Morning');
}

// ---- the flat view the Monday reminder uses is unchanged -------------------
{
  const flat = parseRoster(AMPM);
  eq('flat view still returns one entry per Sunday', flat.length, 2);
  eq('flat view merges both columns',
     flat[0].names, ['Ada Aldridge', 'Tom Aldridge', 'Peter Kingsley']);
  eq('flat view second Sunday',
     flat[1].names, ['Marguerite Ashdown', 'Harold Beckwith', 'Nora Kingsley']);
}
{
  // A Sunday that is nothing but a note has no names, so the reminder skips it
  // rather than texting somebody called "Revival".
  const flat = parseRoster(`Sunday,AM,PM\n2026-09-06,Revival,\n`);
  eq('a note-only Sunday drops out of the flat view', flat.length, 0);
}

// ---- date arithmetic -------------------------------------------------------
eq('a week later', addDays('2026-09-06', 7), '2026-09-13');
// Month, year and DST boundaries: noon UTC is used precisely so none of these
// slip a day the way a bare new Date(iso) would.
eq('across a month boundary', addDays('2026-09-27', 7), '2026-10-04');
eq('across a year boundary', addDays('2026-12-27', 7), '2027-01-03');
eq('across the spring DST change', addDays('2026-03-01', 7), '2026-03-08');
eq('across the autumn DST change', addDays('2026-11-01', 7), '2026-11-08');

// ---- what the bulletin gets ------------------------------------------------
{
  const days = parseRosterDetailed(AMPM);
  const s = singersFor(days, '2026-09-06');
  eq('this Sunday has both services', s!.slots.map((x) => x.label), ['Morning', 'Evening']);
  eq('next Sunday is the one after', s!.next!.sunday, '2026-09-13');
  eq('next Sunday morning', s!.next!.slots[0].names, ['Marguerite Ashdown']);
}
{
  // The last Sunday on the sheet: this week is known, next week is not, and the
  // "next week" line simply does not print.
  const s = singersFor(parseRosterDetailed(AMPM), '2026-09-13');
  eq('last Sunday on the sheet still shows itself', s!.slots[0].names, ['Marguerite Ashdown']);
  eq('with no next week to show', s!.next, null);
}
{
  // A Sunday missing from the sheet, but next week present — still worth
  // printing the reminder, so this must not return null.
  const s = singersFor(parseRosterDetailed(AMPM), '2026-08-30');
  eq('a gap this week still shows next week', s!.next!.sunday, '2026-09-06');
  eq('with nothing for this week', s!.slots, []);
}
eq('a date the sheet knows nothing about yields nothing',
   singersFor(parseRosterDetailed(AMPM), '2026-01-04'), null);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
