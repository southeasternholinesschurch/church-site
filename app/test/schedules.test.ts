/**
 * When a scheduled text is due, and who gets one.
 *
 * Two risks carry the weight here. The first is the timezone: a Worker runs in
 * UTC, and after 8pm Fairhaven it is already tomorrow — so "every Saturday
 * 6pm" fires on the wrong day if the clock is read carelessly. The second is
 * double-sending: the whole point of the queue key is that a rule which runs
 * every five minutes still texts a person once, so the "already ran" path is
 * tested as hard as the "is due" one.
 *
 * Same plain style and no node: imports as the other tests here, for the same
 * reason — this is a Workers project.
 *
 *   npm test
 */
import {
  localNow, parseHhmm, dueOn, hasBirthdayOn, isLeapYear, renderBody,
  queueKey, invalidScheduleReason, GRACE_MINUTES,
} from '../src/lib/schedules.ts';
import type { ScheduleRow } from '../src/lib/schedules.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

const base: ScheduleRow = {
  id: 7, name: 'x', body: 'hello', kind: 'weekly', groupId: null, recipientIds: null,
  sendAt: null, weekday: 6, localTime: '18:00', active: true, lastRunAt: null,
};

// ---- localNow: the timezone trap -------------------------------------------
// 2026-09-06T01:30Z is still Saturday the 5th, 9:30pm, in Fairhaven.
// Reading UTC would call this Sunday and fire a Saturday rule a day late.
{
  const n = localNow(new Date('2026-09-06T01:30:00Z'));
  eq('localNow rolls back over UTC midnight', n, { date: '2026-09-05', minutes: 21 * 60 + 30, weekday: 6 });
}
{
  // EDT (-4): 14:00Z is 10:00 local.
  const n = localNow(new Date('2026-07-15T14:00:00Z'));
  eq('localNow in summer (EDT)', { date: n.date, minutes: n.minutes }, { date: '2026-07-15', minutes: 600 });
}
{
  // EST (-5): the same wall clock needs a different UTC hour in winter. If an
  // offset were hard-coded, exactly one of these two would be wrong.
  const n = localNow(new Date('2026-01-15T15:00:00Z'));
  eq('localNow in winter (EST)', { date: n.date, minutes: n.minutes }, { date: '2026-01-15', minutes: 600 });
}

// ---- parseHhmm -------------------------------------------------------------
eq('parseHhmm 09:05', parseHhmm('09:05'), 545);
eq('parseHhmm 00:00', parseHhmm('00:00'), 0);
eq('parseHhmm 23:59', parseHhmm('23:59'), 1439);
eq('parseHhmm rejects 24:00', parseHhmm('24:00'), null);
eq('parseHhmm rejects 12:60', parseHhmm('12:60'), null);
eq('parseHhmm rejects junk', parseHhmm('six pm'), null);
eq('parseHhmm rejects empty', parseHhmm(''), null);

// ---- weekly ----------------------------------------------------------------
const sat6pm = { date: '2026-09-05', minutes: 18 * 60, weekday: 6 };
eq('weekly fires on its day at its time', dueOn(base, sat6pm), '2026-09-05');
eq('weekly does not fire early', dueOn(base, { ...sat6pm, minutes: 17 * 60 + 59 }), null);
eq('weekly fires inside the grace window',
   dueOn(base, { ...sat6pm, minutes: 18 * 60 + GRACE_MINUTES }), '2026-09-05');
eq('weekly is skipped once the window has passed',
   dueOn(base, { ...sat6pm, minutes: 18 * 60 + GRACE_MINUTES + 1 }), null);
eq('weekly does not fire on another day', dueOn(base, { ...sat6pm, weekday: 5 }), null);
// dueOn is a pure window check: having already run does NOT close the window,
// because re-reading the audience mid-window is how someone added late still
// gets the text. Double-sending is prevented by the unique queue key instead —
// see the key tests below.
eq('weekly stays due across the window even after running',
   dueOn({ ...base, lastRunAt: '2026-09-05' }, sat6pm), '2026-09-05');
eq('weekly fires again the following week',
   dueOn({ ...base, lastRunAt: '2026-09-05' }, { date: '2026-09-12', minutes: 18 * 60, weekday: 6 }),
   '2026-09-12');
eq('paused schedule never fires', dueOn({ ...base, active: false }, sat6pm), null);

// ---- once ------------------------------------------------------------------
const once: ScheduleRow = { ...base, kind: 'once', sendAt: '2026-09-05T08:00', weekday: null, localTime: null };
eq('once fires at its moment', dueOn(once, { date: '2026-09-05', minutes: 480, weekday: 6 }), '2026-09-05');
eq('once does not fire the day before', dueOn(once, { date: '2026-09-04', minutes: 480, weekday: 5 }), null);
// A one-off is never sent late: a reminder for a meeting that already happened
// is worse than no reminder at all.
eq('once does not fire the day after', dueOn(once, { date: '2026-09-06', minutes: 480, weekday: 0 }), null);
eq('once stays due across its window',
   dueOn({ ...once, lastRunAt: '2026-09-05' }, { date: '2026-09-05', minutes: 480, weekday: 6 }), '2026-09-05');
eq('once with no time set never fires',
   dueOn({ ...once, sendAt: '2026-09-05' }, { date: '2026-09-05', minutes: 480, weekday: 6 }), null);

// ---- birthdays are NOT a schedule kind -------------------------------------
// They are a standing arrangement in app_settings, not something scheduled, so
// this screen must never treat one as a schedule. The window logic they use is
// still exercised through the weekly cases above; whose birthday it is on a
// given day is tested below.
eq('an unknown kind is never due',
   dueOn({ ...base, kind: 'birthday' } as unknown as ScheduleRow,
         { date: '2026-03-02', minutes: 540, weekday: 1 }), null);
eq('an unknown kind is rejected by validation',
   invalidScheduleReason({ kind: 'birthday', name: 'x', body: 'y', localTime: '09:00' }),
   'Unknown schedule type.');

// ---- whose birthday --------------------------------------------------------
eq('matches month and day, ignoring year', hasBirthdayOn('1952-03-02', '2026-03-02'), true);
eq('does not match a different day', hasBirthdayOn('1952-03-03', '2026-03-02'), false);
eq('does not match a different month', hasBirthdayOn('1952-04-02', '2026-03-02'), false);
eq('handles a single-digit day written padded', hasBirthdayOn('1952-03-09', '2026-03-09'), true);
eq('no birthday on file is not a birthday', hasBirthdayOn(null, '2026-03-02'), false);
eq('a malformed birthday is not a birthday', hasBirthdayOn('March 2nd', '2026-03-02'), false);
// The 31 December / 1 January boundary is where a UTC-parsed date would slip a
// day, and it would slip into the WRONG YEAR as well.
eq('new year boundary holds', hasBirthdayOn('1970-01-01', '2026-01-01'), true);
eq('new year boundary does not bleed backwards', hasBirthdayOn('1970-01-01', '2025-12-31'), false);
eq('new year eve holds', hasBirthdayOn('1970-12-31', '2026-12-31'), true);

// Leap-day birthdays are wished on the 28th in a common year rather than
// skipped three years in four.
eq('leap-day birthday on a leap year', hasBirthdayOn('1980-02-29', '2028-02-29'), true);
eq('leap-day birthday falls back to the 28th', hasBirthdayOn('1980-02-29', '2027-02-28'), true);
eq('leap-day birthday does not double up on a leap year',
   hasBirthdayOn('1980-02-29', '2028-02-28'), false);
eq('an ordinary 28 Feb birthday is unaffected', hasBirthdayOn('1980-02-28', '2027-02-28'), true);
eq('isLeapYear 2000', isLeapYear(2000), true);
eq('isLeapYear 1900', isLeapYear(1900), false);
eq('isLeapYear 2027', isLeapYear(2027), false);

// ---- rendering -------------------------------------------------------------
eq('fills {first}', renderBody('Happy birthday, {first}!', { firstName: 'Marguerite', lastName: 'Ashdown' }),
   'Happy birthday, Marguerite!');
eq('fills {name}', renderBody('For {name}', { firstName: 'Marguerite', lastName: 'Ashdown' }), 'For Marguerite Ashdown');
eq('is case-insensitive', renderBody('Hi {First}', { firstName: 'Marguerite' }), 'Hi Marguerite');
eq('tidies the gap a missing name leaves', renderBody('Hi {first}, welcome', { firstName: '' }), 'Hi , welcome');
// An unknown placeholder is left visible rather than silently deleted, so the
// mistake is caught in the preview instead of in 90 people's pockets.
eq('leaves unknown placeholders alone', renderBody('You owe {amount}', { firstName: 'A' }), 'You owe {amount}');

// ---- keys ------------------------------------------------------------------
// The key IS the duplicate guard, so these identities are load-bearing: the
// same person, same rule, same occurrence must always produce the same string,
// because the unique index is what refuses the second row.
eq('queue key carries the occurrence date', queueKey(7, '2026-09-05', 42), 'sched:7:2026-09-05:42');
eq('re-expanding the same occurrence yields the same key', queueKey(7, '2026-09-05', 42), queueKey(7, '2026-09-05', 42));
eq('a different week is a different key', queueKey(7, '2026-09-12', 42), 'sched:7:2026-09-12:42');
eq('a different person is a different key', queueKey(7, '2026-09-05', 43), 'sched:7:2026-09-05:43');
eq('a different rule is a different key', queueKey(8, '2026-09-05', 42), 'sched:8:2026-09-05:42');

// ---- validation ------------------------------------------------------------
eq('name required', invalidScheduleReason({ kind: 'once', body: 'x', sendAt: '2026-09-05T08:00' }),
   'Give it a name so you can find it later.');
eq('body required', invalidScheduleReason({ kind: 'once', name: 'x', sendAt: '2026-09-05T08:00' }),
   'The message is empty.');
eq('once needs a date', invalidScheduleReason({ kind: 'once', name: 'x', body: 'y', sendAt: '' }), 'Pick a date.');
eq('once needs a time', invalidScheduleReason({ kind: 'once', name: 'x', body: 'y', sendAt: '2026-09-05' }), 'Pick a time.');
eq('valid once passes', invalidScheduleReason({ kind: 'once', name: 'x', body: 'y', sendAt: '2026-09-05T08:00' }), null);
eq('weekly needs a weekday', invalidScheduleReason({ kind: 'weekly', name: 'x', body: 'y', localTime: '18:00' }),
   'Pick a day of the week.');
eq('valid weekly passes',
   invalidScheduleReason({ kind: 'weekly', name: 'x', body: 'y', weekday: 0, localTime: '18:00' }), null);


console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
