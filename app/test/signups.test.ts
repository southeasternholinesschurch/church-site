/**
 * Sign-up sheets.
 *
 * Three risks carry the weight here, and they are why this file exists rather
 * than what surface it happens to cover.
 *
 * THE FIRST IS THE PUBLIC PREFIX. The sheets are public at `/signup/{token}`
 * and the staff builder that creates them is at `/signups`. The list is matched
 * with startsWith, so `'/signup'` without its trailing slash would make the
 * whole back end public — the sheets, every name on them, and the button that
 * creates more. Two characters. Nothing in a browser would look wrong.
 *
 * THE SECOND IS TWO PEOPLE BEING GIVEN THE SAME TUESDAY. The database prevents
 * it with a unique index; what is testable here is that the seat number offered
 * to a claimer is right, that a full slot offers none, and that a place vacated
 * by a removal genuinely reopens.
 *
 * THE THIRD IS THE REMINDER WINDOW. A Worker runs in UTC, and after 8pm in
 * Indianapolis it is already tomorrow — so "9am the day before" fires on the
 * wrong day if the clock is read carelessly, and the grace window is what
 * decides between a late reminder and a silent one.
 *
 * Same plain style and no node: imports as the other tests here, for the same
 * reason — this is a Workers project and node types are not in scope.
 *
 *   npm test
 */
import {
  addDaysIso, availability, closedReason, dayLabel, daysInRange, daysToAdd,
  DEFAULT_REMINDER_BODY, firstNameOf, invalidRangeReason, invalidReminderReason,
  isIsoDate, isSignupKind, MAX_GENERATED_DAYS, nextSeat, planDays, reminderBodyFor,
  reminderDue, reminderKey, reminderMissed, renderReminder, sheetSummary,
  shortWhen, slotStatus,
} from '../src/lib/signups.ts';
import { isPublicPath } from '../src/lib/public-paths.ts';
import { canAccess } from '../src/lib/permissions.ts';
import type { Role } from '../src/lib/permissions.ts';
import { countSegments } from '../src/lib/sms.ts';
import { localNow } from '../src/lib/schedules.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/* ==== THE ONE THAT WOULD PUBLISH THE BACK END ============================= */

// The public sheet. This must work, or the link in the bulletin bounces the
// whole congregation to a staff sign-in page.
eq('a sheet link is public', isPublicPath('/signup/abc123'), true);
eq('the sheet link with a long token is public',
   isPublicPath('/signup/9f2c1ba47e0d38556a1c0bb2fe74dd10'), true);

// AND THESE MUST NOT BE. `'/signup'` without the slash matches every one of
// them under startsWith, which would hand the builder — and every name on every
// sheet — to anyone who typed the address.
eq('the staff list is NOT public', isPublicPath('/signups'), false);
eq('a staff sheet is NOT public', isPublicPath('/signups/4'), false);
eq('the staff list with a slash is NOT public', isPublicPath('/signups/'), false);

// The prefixes that were already there, so this refactor cannot have dropped
// one silently — a missing '/auth/' locks every member out of signing in.
for (const p of ['/login', '/auth/callback', '/robots.txt', '/directory',
                 '/api/sms/webhook', '/api/bulletin/current']) {
  eq(`${p} stays public`, isPublicPath(p), true);
}
for (const p of ['/', '/people', '/people/12', '/bulletin', '/kids', '/staff',
                 '/api/site/publish']) {
  eq(`${p} stays private`, isPublicPath(p), false);
}

/* ==== and who reaches the BUILDER ======================================== */

/*
 * lib/permissions.ts needed NO CHANGE for this feature, which is a claim worth
 * holding to rather than asserting in a comment. An editor already reaches
 * everything outside ADMIN_ONLY and the kids roles are allow-listed to /kids
 * alone — so the church secretary gets the sheets and a children's volunteer
 * does not, which is right: a meal train is office work, and the sheets carry
 * names and notes about families.
 *
 * Here because it is the sign-up feature's claim to keep true. If somebody
 * later adds /api/signups/, permissions.ts has to hear about it — there is a
 * comment there about the time gating only /website left an editor able to
 * post straight to /api/site.
 */
for (const role of ['admin', 'editor'] as Role[]) {
  eq(`${role} reaches the sign-up builder`, canAccess(role, '/signups'), true);
  eq(`${role} reaches one sheet`, canAccess(role, '/signups/4'), true);
}
for (const role of ['kids', 'kids-director'] as Role[]) {
  eq(`${role} is refused the sign-up builder`, canAccess(role, '/signups'), false);
  eq(`${role} is refused one sheet`, canAccess(role, '/signups/4'), false);
}

/* ==== SEATS: two families must never both have Tuesday ==================== */

eq('an empty slot offers seat 1', nextSeat([], 1), 1);
eq('a slot of one, taken, offers nothing', nextSeat([1], 1), null);
eq('a slot of three with one taker offers 2', nextSeat([1], 3), 2);
eq('a slot of three with two takers offers 3', nextSeat([1, 2], 3), 3);
eq('a full slot of three offers nothing', nextSeat([1, 2, 3], 3), null);

// A place somebody left must genuinely reopen. Offering one past the highest
// seat instead would leave a full-looking slot with a gap in it forever.
eq('a vacated first seat is reoffered', nextSeat([2, 3], 3), 1);
eq('a vacated middle seat is reoffered', nextSeat([1, 3], 3), 2);

// No limit: always another seat, and never the same one twice.
eq('an unlimited slot keeps offering', nextSeat([1, 2, 3, 4], null), 5);
eq('an unlimited empty slot offers 1', nextSeat([], null), 1);

// Staff overriding a full slot — the office recording that somebody rang up.
// Capacity is passed as null on that path, so it must not refuse.
eq('staff may go past the limit', nextSeat([1, 2, 3], null), 4);

/* ==== availability: what the sheet SAYS =================================== */

eq('an untaken day reads Available',
   availability(1, 0), { full: false, open: 1, text: 'Available' });
eq('a taken day of one is full',
   availability(1, 1), { full: true, open: 0, text: 'Full' });
// The brief's own example: capacity 3, one taker.
eq('three with one taker says two still open',
   availability(3, 1), { full: false, open: 2, text: '2 still open.' });
eq('the last place is singular',
   availability(3, 2), { full: false, open: 1, text: '1 still open.' });
eq('no limit never fills',
   availability(null, 40), { full: false, open: null, text: 'Room for more' });
// Defensive: staff can put a fourth person in a slot of three. It must read as
// full rather than as "-1 still open."
eq('over the limit still reads full',
   availability(3, 4), { full: true, open: 0, text: 'Full' });

/* ==== what a row SAYS, which is the whole point of the sheet ============== */

/*
 * The bug this is written after: a full list showed four names comma-joined
 * into the right-hand column and nothing else. The form was gone, because the
 * slot was full — but nothing on the page said so, and it read as broken rather
 * than as finished.
 */

// A place for ONE PERSON answers with the name. "Full" beside it is noise, and
// the name is what a family actually wants to know.
eq('a taken day says who has it',
   slotStatus(1, ['Ada Aldridge'], false), { text: 'Ada Aldridge', stacked: false });
eq('an untaken day says Available',
   slotStatus(1, [], false), { text: 'Available', stacked: false });

// A place for SEVERAL answers with the count, and the names go underneath.
eq('a full dish says Full and stacks the names',
   slotStatus(2, ['Ada Aldridge', 'Mary Kingsley'], false), { text: 'Full', stacked: true });
eq('a part-filled dish still counts down',
   slotStatus(6, ['Luke Kingsley'], false), { text: '5 still open.', stacked: true });
eq('an empty dish says Available without stacking',
   slotStatus(6, [], false), { text: 'Available', stacked: false });
// THE ONE FROM THE SCREENSHOT: a list of four, capped at four.
eq('a full list says Full rather than just listing people',
   slotStatus(4, ['Ada Aldridge', 'Ruth Camp', 'Sara Bell', 'Mary Kingsley'], false),
   { text: 'Full', stacked: true });
eq('an uncapped list keeps welcoming',
   slotStatus(null, ['Ada Aldridge'], false), { text: 'Room for more', stacked: true });

// A CLOSED SHEET NEVER ADVERTISES PLACES. "5 still open." under a banner saying
// the sign-up has closed is the software contradicting itself.
eq('a closed part-filled row reports rather than offers',
   slotStatus(6, ['Luke Kingsley'], true), { text: '1 signed up', stacked: true });
eq('a closed fuller row counts them',
   slotStatus(6, ['Luke Kingsley', 'Ruth Camp'], true), { text: '2 signed up', stacked: true });
eq('a closed day still names who took it',
   slotStatus(1, ['Ada Aldridge'], true), { text: 'Ada Aldridge', stacked: false });
eq('a closed day nobody took says so',
   slotStatus(1, [], true), { text: 'Nobody signed up', stacked: false });
eq('a closed empty dish says so too',
   slotStatus(4, [], true), { text: 'Nobody signed up', stacked: false });

/* ==== dates: the trap this project has already fallen into once =========== */

// new Date('2026-10-14') is UTC midnight, which in Indianapolis is the EVENING
// OF THE 13TH. Every date here goes through noon UTC for that reason.
eq('a day reads as its own weekday', dayLabel('2026-10-14'), 'Wednesday, 14 October');
eq('the first of a month is not the last of the one before',
   dayLabel('2026-11-01'), 'Sunday, 1 November');
eq('a text message says it short', shortWhen('2026-10-14'), 'Wed 14 Oct');
eq('short form keeps the right month', shortWhen('2026-01-01'), 'Thu 1 Jan');

eq('adding a day', addDaysIso('2026-10-14', 1), '2026-10-15');
eq('subtracting across a month end', addDaysIso('2026-11-01', -1), '2026-10-31');
// Across the spring DST change, where a naive +86400000 lands on the same day.
eq('adding across the spring clock change', addDaysIso('2026-03-08', 1), '2026-03-09');
eq('adding across a leap day', addDaysIso('2028-02-28', 1), '2028-02-29');

eq('isIsoDate accepts a date', isIsoDate('2026-10-14'), true);
eq('isIsoDate refuses a timestamp', isIsoDate('2026-10-14T09:00:00Z'), false);
eq('isIsoDate refuses nothing', isIsoDate(null), false);

/* ==== filling in the days ================================================= */

eq('a week is seven days',
   daysInRange('2026-10-12', '2026-10-18').length, 7);
eq('a week starts where it was told',
   daysInRange('2026-10-12', '2026-10-18')[0], '2026-10-12');
eq('a week ends where it was told',
   daysInRange('2026-10-12', '2026-10-18')[6], '2026-10-18');
eq('one day is one day', daysInRange('2026-10-12', '2026-10-12'), ['2026-10-12']);
eq('a month boundary is crossed cleanly',
   daysInRange('2026-10-30', '2026-11-02'),
   ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);

eq('a backwards range is refused',
   invalidRangeReason('2026-10-18', '2026-10-12') !== null, true);
// The real case: a mistyped year. Three and a half thousand rows, and nothing
// between the form and the database would have objected.
eq('a mistyped year is refused',
   invalidRangeReason('2026-10-12', '2036-10-18') !== null, true);
eq(`${MAX_GENERATED_DAYS} days is still allowed`,
   invalidRangeReason('2026-01-01', addDaysIso('2026-01-01', MAX_GENERATED_DAYS - 1)), null);
eq('one day past the limit is not',
   invalidRangeReason('2026-01-01', addDaysIso('2026-01-01', MAX_GENERATED_DAYS)) !== null, true);

// PRESSING IT TWICE. The whole point: a day somebody has claimed must not be
// disturbed, so the second press adds nothing at all.
eq('a second press adds nothing',
   daysToAdd(['2026-10-12', '2026-10-13', '2026-10-14'], '2026-10-12', '2026-10-14'), []);
// And extending the range adds only the new end.
eq('extending the range adds only what is new',
   daysToAdd(['2026-10-12', '2026-10-13'], '2026-10-12', '2026-10-15'),
   ['2026-10-14', '2026-10-15']);
eq('a gap in the middle is filled without touching the rest',
   daysToAdd(['2026-10-12', '2026-10-14'], '2026-10-12', '2026-10-14'), ['2026-10-13']);

/* ==== narrowing the range, which is the half that was missing ============= */

/*
 * Adding was the easy half. The pastor found the other: set 21-29, then narrow to
 * 21-25, and the four days you dropped stayed on the sheet — still collectable,
 * with nothing to say they were meant to be gone.
 *
 * The rule that makes trimming safe is the one worth testing hardest: A DAY
 * SOMEBODY HAS CLAIMED IS NEVER REMOVED. Somebody has told a family they are
 * bringing Tuesday and the family has stopped planning for it; a mistyped date
 * must not quietly undo that.
 */
const day = (id: number, onDate: string | null, taken = 0) => ({ id, onDate, taken });

// Nothing on the sheet yet: pure addition, as before.
eq('an empty sheet just fills',
   planDays([], '2026-10-12', '2026-10-14'),
   { add: ['2026-10-12', '2026-10-13', '2026-10-14'], remove: [], keep: [] });

// Pressing it again with the same range changes nothing at all.
eq('the same range is a no-op',
   planDays([day(1, '2026-10-12'), day(2, '2026-10-13')], '2026-10-12', '2026-10-13'),
   { add: [], remove: [], keep: [] });

// Widening adds only the new end.
eq('widening adds only what is new',
   planDays([day(1, '2026-10-12'), day(2, '2026-10-13')], '2026-10-12', '2026-10-14'),
   { add: ['2026-10-14'], remove: [], keep: [] });

// NARROWING now takes the dropped days off — the bug.
eq('narrowing removes the days that fell outside',
   planDays([day(1, '2026-10-12'), day(2, '2026-10-13'), day(3, '2026-10-14')],
            '2026-10-12', '2026-10-13'),
   { add: [], remove: [3], keep: [] });
eq('narrowing from both ends removes from both ends',
   planDays([day(1, '2026-10-11'), day(2, '2026-10-12'), day(3, '2026-10-13')],
            '2026-10-12', '2026-10-12'),
   { add: [], remove: [1, 3], keep: [] });

// Moving the span wholesale: the old days go, the new ones arrive.
eq('a moved span swaps the days',
   planDays([day(1, '2026-10-12'), day(2, '2026-10-13')], '2026-10-20', '2026-10-21'),
   { add: ['2026-10-20', '2026-10-21'], remove: [1, 2], keep: [] });

// THE ONE THAT MATTERS. A claimed day outside the range is KEPT and REPORTED.
eq('a claimed day outside the range is never removed',
   planDays([day(1, '2026-10-12'), day(2, '2026-10-13'), day(3, '2026-10-14', 1)],
            '2026-10-12', '2026-10-13'),
   { add: [], remove: [], keep: ['2026-10-14'] });
// Its unclaimed neighbours still go.
eq('its empty neighbours still go',
   planDays([day(1, '2026-10-12'), day(2, '2026-10-13', 2), day(3, '2026-10-14')],
            '2026-10-12', '2026-10-12'),
   { add: [], remove: [3], keep: ['2026-10-13'] });
// Several kept days come back sorted, so the wording reads in order.
eq('kept days come back in order',
   planDays([day(1, '2026-10-16', 1), day(2, '2026-10-14', 1)], '2026-10-12', '2026-10-13'),
   { add: ['2026-10-12', '2026-10-13'], remove: [], keep: ['2026-10-14', '2026-10-16'] });

/*
 * UNDATED SLOTS ARE LEFT ALONE ENTIRELY. A meal-train row whose date somebody
 * cleared by hand falls outside every range, and without this it would be swept
 * away by a press of a button about something else.
 */
eq('an undated row is not touched',
   planDays([day(1, null), day(2, '2026-10-12')], '2026-10-12', '2026-10-12'),
   { add: [], remove: [], keep: [] });
eq('an undated row with people on it is not touched either',
   planDays([day(1, null, 3)], '2026-10-12', '2026-10-13'),
   { add: ['2026-10-12', '2026-10-13'], remove: [], keep: [] });

// A range it would refuse to fill is a range it must not trim by either. A
// mistyped year that deletes the whole sheet is the worst possible reading.
eq('a mistyped year changes nothing at all',
   planDays([day(1, '2026-10-12'), day(2, '2026-10-13')], '2026-10-12', '2036-10-13'),
   { add: [], remove: [], keep: [] });
eq('a backwards range changes nothing at all',
   planDays([day(1, '2026-10-12'), day(2, '2026-10-13')], '2026-10-14', '2026-10-12'),
   { add: [], remove: [], keep: [] });

/* ==== when a sheet has shut ============================================== */

const sheet = (o: Partial<{ status: string; closesOn: string | null; eventDate: string | null }>) =>
  ({ status: 'open', closesOn: null, eventDate: null, ...o });

eq('an open sheet with days ahead is open',
   closedReason(sheet({}), ['2026-10-20', '2026-10-21'], '2026-10-14'), null);
eq('staff closing it closes it',
   closedReason(sheet({ status: 'closed' }), ['2026-10-20'], '2026-10-14') !== null, true);
eq('a passed closing date closes it',
   closedReason(sheet({ closesOn: '2026-10-13' }), ['2026-10-20'], '2026-10-14') !== null, true);
eq('the closing date is inclusive',
   closedReason(sheet({ closesOn: '2026-10-14' }), ['2026-10-20'], '2026-10-14'), null);

// THE ONE THAT MATTERS. A link in an old bulletin must not go on collecting
// meals for a family who stopped needing them a month ago.
eq('a meal train whose last day has passed is closed',
   closedReason(sheet({}), ['2026-09-10', '2026-09-11'], '2026-10-14') !== null, true);
// ...but not while ANY day is still to come.
eq('one day still ahead keeps it open',
   closedReason(sheet({}), ['2026-09-10', '2026-10-20'], '2026-10-14'), null);
eq('today itself keeps it open',
   closedReason(sheet({}), ['2026-10-14'], '2026-10-14'), null);

// A dish sheet has no dated slots, so the dinner's own date is what goes stale.
eq('a dinner that has happened is closed',
   closedReason(sheet({ eventDate: '2026-09-20' }), [null, null], '2026-10-14') !== null, true);
eq('a dinner still to come is open',
   closedReason(sheet({ eventDate: '2026-10-20' }), [null, null], '2026-10-14'), null);
// A list with no dates at all never closes itself. Nothing says it should.
eq('an undated list stays open',
   closedReason(sheet({}), [null], '2026-10-14'), null);

/* ==== the reminder window ================================================ */

const at = (iso: string) => localNow(new Date(iso));

// 9am the day before. 2026-10-14T13:00Z is 9am on the 14th in Indianapolis
// (EDT), so the reminder for the 15th is due.
eq('due at 9am the day before', reminderDue('2026-10-15', at('2026-10-14T13:00:00Z')), true);
eq('not due at 8:59 the day before',
   reminderDue('2026-10-15', at('2026-10-14T12:59:00Z')), false);
eq('still due at 11pm the day before',
   reminderDue('2026-10-15', at('2026-10-15T03:00:00Z')), true);

// THE UTC TRAP. 2026-10-15T02:00Z is 10pm on the 14th in Indianapolis. Reading
// the clock as UTC would call it the 15th and drop the reminder out of its
// window an evening early.
eq('10pm the day before is still the day before',
   reminderDue('2026-10-15', at('2026-10-15T02:00:00Z')), true);

// THE GRACE WINDOW, in the shape dueSunday() uses: a cron outage should mean a
// late reminder, not a silent one.
eq('still sendable at 6am on the day itself',
   reminderDue('2026-10-15', at('2026-10-15T10:00:00Z')), true);
eq('NOT sendable at 9am on the day itself',
   reminderDue('2026-10-15', at('2026-10-15T13:00:00Z')), false);
eq('not due two days ahead', reminderDue('2026-10-15', at('2026-10-13T13:00:00Z')), false);
eq('not due after the day', reminderDue('2026-10-15', at('2026-10-16T13:00:00Z')), false);
eq('an undated sign-up is never due', reminderDue(null, at('2026-10-14T13:00:00Z')), false);

// Past the window is a VISIBLE miss, not silence.
eq('9am on the day is a miss', reminderMissed('2026-10-15', at('2026-10-15T13:00:00Z')), true);
eq('the day after is a miss', reminderMissed('2026-10-15', at('2026-10-16T13:00:00Z')), true);
eq('inside the window is not a miss',
   reminderMissed('2026-10-15', at('2026-10-14T13:00:00Z')), false);
eq('before the window is not a miss',
   reminderMissed('2026-10-15', at('2026-10-10T13:00:00Z')), false);
// Due and missed must never both be true — one queues a text, the other records
// that none was sent.
for (const iso of ['2026-10-14T12:00:00Z', '2026-10-14T13:00:00Z', '2026-10-15T02:00:00Z',
                   '2026-10-15T10:00:00Z', '2026-10-15T13:00:00Z', '2026-10-16T13:00:00Z']) {
  eq(`due and missed are exclusive at ${iso}`,
     reminderDue('2026-10-15', at(iso)) && reminderMissed('2026-10-15', at(iso)), false);
}

/* ==== the key that stops a second text =================================== */

// A sign-up is for exactly ONE slot on ONE date, so its id IS the occurrence.
// No date rides along, unlike a weekly rule's key.
eq('the queue key is the sign-up', reminderKey(41), 'signup:41');
eq('two sign-ups have two keys', reminderKey(41) === reminderKey(42), false);

/* ==== the message ======================================================== */

eq('the default wording is one GSM-7 segment',
   { encoding: countSegments(renderReminder(DEFAULT_REMINDER_BODY,
       { first: 'Bartholomew', when: 'Wed 12 Nov' })).encoding,
     segments: countSegments(renderReminder(DEFAULT_REMINDER_BODY,
       { first: 'Bartholomew', when: 'Wed 12 Nov' })).segments },
   { encoding: 'GSM-7', segments: 1 });

eq('placeholders are filled',
   renderReminder('Hello {first}, that is {when}.', { first: 'Ada', when: 'Tue 14 Oct' }),
   'Hello Ada, that is Tue 14 Oct.');
// Unknown placeholders are LEFT ALONE, the same rule renderBody follows.
// Deleting one silently would send a sentence with a hole in it.
eq('an unknown placeholder survives',
   renderReminder('Bring {dish} on {when}.', { when: 'Tue 14 Oct' }),
   'Bring {dish} on Tue 14 Oct.');

eq('the first name is the first word', firstNameOf('Alan Reeve'), 'Alan');
eq('a one-word name is its own first name', firstNameOf('Ada'), 'Ada');
eq('a padded name still works', firstNameOf('  Ada  Aldridge '), 'Ada');
eq('no name is no name', firstNameOf(''), '');

// THE EXPENSIVE MISTAKE. A curly apostrophe pasted from Word drops the message
// to UCS-2 and cuts the budget from 160 characters to 70 — silently, on every
// reminder ever sent.
eq('a curly apostrophe is refused',
   invalidReminderReason('SHC - Don’t forget your meal tomorrow, {when}.') !== null, true);
eq('an em dash is refused',
   invalidReminderReason('SHC — your meal is tomorrow, {when}.') !== null, true);
eq('the plain version is fine',
   invalidReminderReason("SHC - Don't forget your meal tomorrow, {when}."), null);
eq('an empty message is refused', invalidReminderReason('   ') !== null, true);
eq('the default passes its own validator',
   invalidReminderReason(DEFAULT_REMINDER_BODY), null);
// Measured with the placeholders FILLED, not as written: "{first}" is seven
// characters and a real name can be eleven, so a template validated as written
// would slip into a second segment for a third of the church.
eq('a long message is refused',
   invalidReminderReason('Fairhaven Community Church - This is a reminder that you kindly '
     + 'signed up to bring a meal for the family tomorrow, {when}, and we wanted to say '
     + 'thank you very much indeed for your kindness, {first}.') !== null, true);

// A stored value that is unusable degrades to the built-in wording rather than
// to silence — the shape getInviteTemplate and getBirthdaySettings both use.
eq('a good stored body is used', reminderBodyFor('SHC - Meal tomorrow, {when}.'),
   'SHC - Meal tomorrow, {when}.');
eq('a blank stored body falls back', reminderBodyFor(''), DEFAULT_REMINDER_BODY);
eq('a null stored body falls back', reminderBodyFor(null), DEFAULT_REMINDER_BODY);
eq('a broken stored body falls back',
   reminderBodyFor('SHC — far too long a message '.repeat(12)), DEFAULT_REMINDER_BODY);

/* ==== the staff list's one line ========================================== */

const cap1 = [{ capacity: 1 }, { capacity: 1 }, { capacity: 1 },
               { capacity: 1 }, { capacity: 1 }, { capacity: 1 }, { capacity: 1 }];
eq('a meal train counts days', sheetSummary('meal-train', cap1, 5), '5 of 7 days taken');
// Two meals a day: "5 of 7 days" would be a lie, so it counts places instead.
eq('two meals a day counts meals',
   sheetSummary('meal-train', cap1.map(() => ({ capacity: 2 })), 5), '5 of 14 meals taken');
eq('a dish sheet counts parts',
   sheetSummary('dish', [{ capacity: 2 }, { capacity: 6 }], 3), '3 of 8 claimed');
eq('a capped list counts places',
   sheetSummary('list', [{ capacity: 20 }], 14), '14 of 20 signed up');
eq('an uncapped list says what it knows',
   sheetSummary('list', [{ capacity: null }], 14), '14 signed up');
eq('one is singular', sheetSummary('list', [{ capacity: null }], 1), '1 signed up');
eq('an empty sheet says so', sheetSummary('dish', [], 0), 'Nothing to sign up for yet');

/* ==== the kinds ========================================================== */

for (const k of ['meal-train', 'list', 'dish']) eq(`${k} is a kind`, isSignupKind(k), true);
// Whatever arrives in a form field is a string until this says otherwise.
for (const k of ['', 'mealtrain', 'MEAL-TRAIN', 'drop table']) {
  eq(`${JSON.stringify(k)} is not a kind`, isSignupKind(k), false);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
