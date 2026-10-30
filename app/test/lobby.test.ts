/**
 * The lobby screen.
 *
 * Three risks, and they are the ones this file holds.
 *
 * THE PUBLIC PATH. /lobby and its feed are public, EXACTLY. A staff "Lobby"
 * remote is planned at /lobby/remote, and the public list is otherwise matched
 * with startsWith — so a `'/lobby'` prefix would publish the remote the day it
 * was written. The same two-character trap as `/signup/` and `/signups`.
 *
 * THE CLOCK. A TV box may think it is anywhere. The church's wall clock is the
 * only one that matters, across both DST changes, and Sunday evening's two
 * back-to-back services must not both be "on" at once.
 *
 * THE CALENDAR. Easter moves, Advent depends on Christmas's weekday, and
 * Thanksgiving is "the fourth Thursday" — each of which is easy to get a day
 * wrong in one year out of seven. So several years of each, checked against
 * published dates.
 *
 * Same plain style and no node: imports as the other tests, for the same
 * reason — this is a Workers project.
 *
 *   npm test
 */
import {
  addDays, adventSunday, bulletinWhen, countdownServices, screenPhotos, INVITE_PHOTOS, INVITE_SECONDS, countdownText, dwellSeconds, materialFor, minutesUntil, photoOrder, LOBBY_PHOTOS, clockParts, clockText, daysBetween, easterSunday, nextService,
  phaseAt, scenesFor, seasonFor, servicesOn, shouldReload, stepChannel, thanksgiving, upcomingEvents,
  zonedInstant, celebrationPages, sermonWhen, COMING_UP_MAX, PRAYER_PER_PAGE, type ClockParts, type LobbyEvent, type LobbyFeed,
  type LobbySermon, type Scene,
  stampOf,
} from '../src/lib/lobby.ts';
import { heroesFor, heroHtml, heroTitleSize, validateHero, HERO_SECONDS, type LobbyHero } from '../src/lib/lobby-heroes.ts';
import { isPublicPath } from '../src/lib/public-paths.ts';
import { cleanCopy, copyText, parseCopy, COPY_SECTIONS } from '../src/lib/lobby-copy.ts';
import { cleanSettings, noticeLive, parseSettings, HIDEABLE, type LobbySettings } from '../src/lib/lobby-settings.ts';
import { qrFor } from '../src/lib/qr.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/* ==== THE PUBLIC PATH ===================================================== */

eq('/lobby is public', isPublicPath('/lobby'), true);
eq('/lobby/ is public (a TV browser may add the slash)', isPublicPath('/lobby/'), true);
eq('the feed is public', isPublicPath('/api/lobby/feed'), true);
eq('the feed with a slash is public', isPublicPath('/api/lobby/feed/'), true);
// AND THESE MUST NOT BE.
for (const p of ['/lobby/remote', '/lobby/remote/', '/lobbyx', '/lobby-admin', '/lobby//',
                 '/api/lobby', '/api/lobby/', '/api/lobby/pin', '/api/lobby/feedx', '/api/lobby/feed/x']) {
  eq(`${p} stays private`, isPublicPath(p), false);
}
// A hero frame's graphic is public; the staff route that makes them is not.
eq('a hero graphic is public', isPublicPath('/api/lobby/hero/3'), true);
for (const p of ['/api/lobby/heroes', '/api/lobby/heroes/3', '/api/lobby/hero', '/api/lobby/herox/1']) {
  eq(`${p} stays private`, isPublicPath(p), false);
}
eq('an uploaded lobby photo is public', isPublicPath('/api/lobby/photo/3'), true);
for (const p of ['/api/lobby/photos', '/api/lobby/photo', '/api/lobby/photox/1']) {
  eq(`${p} stays private`, isPublicPath(p), false);
}
// The rest of the list is untouched by the exact branch.
eq('/signup/abc is still public', isPublicPath('/signup/abc'), true);
eq('/signups is still private', isPublicPath('/signups'), false);
eq('/ is still private', isPublicPath('/'), false);

/* ==== THE CHURCH'S CLOCK ================================================== */

// 2026-10-25 is a Sunday. Fairhaven is UTC-4 in October.
eq('clock parts in church time', clockParts(new Date('2026-10-25T13:40:00Z')),
   { date: '2026-10-25', weekday: 0, minutes: 9 * 60 + 40, seconds: 0 });
// 1:30am UTC Thursday is still Wednesday evening at the church — the bug that
// once filed a Wednesday service under Thursday.
eq('UTC tomorrow is still Wednesday at church', clockParts(new Date('2026-10-29T01:30:00Z')).weekday, 3);
eq('just after midnight is 0 minutes, not 24:00', clockParts(new Date('2026-10-26T04:00:30Z')).minutes, 0);

eq('?at= reads church time (EDT)', zonedInstant('2026-10-25T09:40')?.toISOString(), '2026-10-25T13:40:00.000Z');
eq('?at= reads church time (EST)', zonedInstant('2026-12-20T09:40')?.toISOString(), '2026-12-20T14:40:00.000Z');
// Both DST boundaries: 2026-03-08 (spring forward) and 2026-11-01 (fall back).
eq('?at= the morning after spring-forward', zonedInstant('2026-03-08T10:00')?.toISOString(), '2026-03-08T14:00:00.000Z');
eq('?at= the evening before spring-forward', zonedInstant('2026-03-07T22:00')?.toISOString(), '2026-03-08T03:00:00.000Z');
eq('?at= the morning after fall-back', zonedInstant('2026-11-01T10:00')?.toISOString(), '2026-11-01T15:00:00.000Z');
eq('?at= the evening before fall-back', zonedInstant('2026-10-31T22:00')?.toISOString(), '2026-11-01T02:00:00.000Z');
eq('?at= round-trips to the wall clock', clockParts(zonedInstant('2026-11-01T17:30')!).minutes, 17 * 60 + 30);
eq('?at= rejects junk', zonedInstant('next sunday'), null);

eq('addDays across a month', addDays('2026-10-30', 3), '2026-11-02');
eq('addDays across fall-back', addDays('2026-10-31', 1), '2026-11-01');
eq('daysBetween across spring-forward', daysBetween('2026-03-07', '2026-03-09'), 2);
eq('clockText', [clockText(600), clockText(1050), clockText(0), clockText(720)],
   ['10:00 am', '5:30 pm', '12:00 am', '12:00 pm']);

/* ==== before, during, after =============================================== */

const at = (date: string, weekday: number, h: number, m = 0): ClockParts =>
  ({ date, weekday, minutes: h * 60 + m, seconds: 0 });
const SUN = (h: number, m = 0) => at('2026-10-25', 0, h, m);
const WED = (h: number, m = 0) => at('2026-10-28', 3, h, m);
const phase = (c: ClockParts) => { const p = phaseAt(c); return [p.phase, p.service?.label ?? null, p.minutesToStart]; };

eq('Sunday has three services in order', servicesOn(0).map((s) => [s.label, s.start, s.end]), [
  ['Sunday Morning Worship', 600, 690],
  // Clamped: Sunday School ends when Evening Worship starts, not at 18:00.
  ['Sunday School', 990, 1050],
  ['Sunday Evening Worship', 1050, 1140],
]);
eq('Monday has none', servicesOn(1), []);

eq('Sunday 8:59 is daytime', phase(SUN(8, 59)), ['day', null, null]);
eq('Sunday 9:00 starts the countdown', phase(SUN(9, 0)), ['before', 'Sunday Morning Worship', 60]);
eq('Sunday 9:40 is twenty minutes out', phase(SUN(9, 40)), ['before', 'Sunday Morning Worship', 20]);
eq('Sunday 10:00 is during', phase(SUN(10, 0)), ['during', 'Sunday Morning Worship', null]);
eq('Sunday 11:29 is still during', phase(SUN(11, 29)), ['during', 'Sunday Morning Worship', null]);
eq('Sunday 11:30 is after', phase(SUN(11, 30)), ['after', 'Sunday Morning Worship', null]);
eq('Sunday 12:30 is daytime again', phase(SUN(12, 30)), ['day', null, null]);
// The back-to-back pair.
// Sunday School is a class, not a counted service (the pastor, 2026-10-22): it
// makes no phase of its own, and 16:30 is simply the hour before Evening Worship.
eq('Sunday 15:30 is an ordinary afternoon', phase(SUN(15, 30)), ['day', null, null]);
eq('Sunday 16:45 is before Evening Worship, not during Sunday School',
   phase(SUN(16, 45)), ['before', 'Sunday Evening Worship', 45]);
eq('Sunday 17:29 is a minute before Evening Worship', phase(SUN(17, 29)), ['before', 'Sunday Evening Worship', 1]);
eq('Sunday 17:30 is Evening Worship, never "after Sunday School"',
   phase(SUN(17, 30)), ['during', 'Sunday Evening Worship', null]);
eq('Sunday 19:00 is after Evening Worship', phase(SUN(19, 0)), ['after', 'Sunday Evening Worship', null]);
eq('Sunday 22:00 is night', phase(SUN(22, 0)), ['night', null, null]);
eq('Wednesday 18:15', phase(WED(18, 15)), ['before', 'Wednesday Prayer & Praise', 45]);
eq('Wednesday 21:00 is after', phase(WED(21, 0)), ['after', 'Wednesday Prayer & Praise', null]);
eq('Thursday 3am is night', phase(at('2026-10-29', 4, 3)), ['night', null, null]);
eq('Thursday 6am is day', phase(at('2026-10-29', 4, 6)), ['day', null, null]);
// Real instants, so the whole path from Date to phase is covered across DST.
eq('Sunday 9:40 after fall-back, from an instant',
   phaseAt(clockParts(new Date('2026-11-01T14:40:00Z'))).phase, 'before');
eq('Sunday 10:15 after spring-forward, from an instant',
   phaseAt(clockParts(new Date('2026-03-08T14:15:00Z'))).phase, 'during');
// The live service list wins over the fallback when the site sends one.
eq('a Saturday service from the site is honoured',
   phaseAt(at('2026-10-31', 6, 17, 30), [{ label: 'Youth night', day: 'Saturday', time: '18:00' }]).phase,
   'before');

eq('next service from Thursday is Sunday morning', nextService(at('2026-10-29', 4, 12)),
   { label: 'Sunday Morning Worship', date: '2026-11-01', start: 600, daysAway: 3 });
eq('next service on Sunday at noon is Evening Worship, not Sunday School', nextService(SUN(12))?.label, 'Sunday Evening Worship');

/* ==== the countdown chain: morning → evening → Wednesday → morning ======== */

const countdown = (iso: string) => {
  const now = zonedInstant(iso)!;
  const n = nextService(clockParts(now))!;
  return `${n.label} in ${countdownText(minutesUntil(n, now))}`;
};
eq('Sunday 9:40 counts to the morning', countdown('2026-10-25T09:40'), 'Sunday Morning Worship in 20 min');
eq('the moment the morning begins, it counts to the evening', countdown('2026-10-25T10:00'), 'Sunday Evening Worship in 7 h 30 min');
eq('during Sunday School it still counts to the evening', countdown('2026-10-25T16:45'), 'Sunday Evening Worship in 45 min');
eq('the moment the evening begins, it counts to Wednesday', countdown('2026-10-25T17:30'), 'Wednesday Prayer & Praise in 3 days, 1 h');
eq('Wednesday afternoon', countdown('2026-10-28T13:15'), 'Wednesday Prayer & Praise in 5 h 45 min');
// That week crosses the end of daylight saving, so it is an hour longer than
// the wall clocks suggest: 3 days 16 h, not 15.
eq('the moment Wednesday begins, it counts to Sunday', countdown('2026-10-28T19:00'), 'Sunday Morning Worship in 3 days, 16 h');
eq('…and 15 h in an ordinary week', countdown('2026-10-21T19:00'), 'Sunday Morning Worship in 3 days, 15 h');
eq('Saturday night', countdown('2026-10-31T21:00'), 'Sunday Morning Worship in 14 h');
// Real elapsed time across the fall-back night: 10 pm Saturday to 10 am
// Sunday is thirteen hours on 1 November, not twelve.
eq('across the end of daylight saving', countdown('2026-10-31T22:00'), 'Sunday Morning Worship in 13 h');
eq('never "0 min"', countdownText(0), '1 min');
eq('an exact hour has no minutes', countdownText(120), '2 h');
eq('one day', countdownText(1440 + 30), '1 day');
eq('Sunday School can still be counted if nothing else is', countdownServices([{ label: 'Sunday School', day: 'Sunday', time: '16:30' }]).length, 1);

/* ==== the photographs, reshuffled with each bulletin ====================== */

const sorted = (a: number[]) => [...a].sort((x, y) => x - y);
eq('every photograph appears once in the order', sorted(photoOrder('2026-10-25')), LOBBY_PHOTOS.map((_, i) => i));
eq('the same bulletin gives the same order (a reload does not reshuffle)',
   photoOrder('2026-10-25'), photoOrder('2026-10-25'));
eq('a new bulletin gives a new order', JSON.stringify(photoOrder('2026-10-25')) !== JSON.stringify(photoOrder('2026-11-01')), true);

eq('next service on Wednesday 19:30 is Sunday', nextService(WED(19, 30))?.date, '2026-11-01');

/* ==== seasons ============================================================= */

// Published Western Easter dates.
for (const [y, d] of [[2024, '2024-03-31'], [2025, '2025-04-20'], [2026, '2026-04-05'],
                      [2027, '2027-03-28'], [2028, '2028-04-16'], [2029, '2029-04-01'],
                      [2030, '2030-04-21'], [2038, '2038-04-25'], [2035, '2035-03-25']] as const) {
  eq(`Easter ${y}`, easterSunday(y), d);
}
// First Sunday of Advent.
for (const [y, d] of [[2024, '2024-12-01'], [2025, '2025-11-30'], [2026, '2026-11-29'],
                      [2027, '2027-11-28'], [2028, '2028-12-03'], [2029, '2029-12-02']] as const) {
  eq(`Advent Sunday ${y}`, adventSunday(y), d);
}
// Thanksgiving, including the earliest (22nd) and latest (28th) it can fall.
for (const [y, d] of [[2024, '2024-11-28'], [2025, '2025-11-27'], [2026, '2026-11-26'],
                      [2027, '2027-11-25'], [2028, '2028-11-23'], [2029, '2029-11-22']] as const) {
  eq(`Thanksgiving ${y}`, thanksgiving(y), d);
}

eq('an ordinary Sunday in October', seasonFor('2026-10-25'), 'ordinary');
eq('Ash Wednesday 2026 is Lent', seasonFor('2026-02-18'), 'lent');
eq('the day before Ash Wednesday is not', seasonFor('2026-02-17'), 'ordinary');
eq('Palm Sunday 2026 is Holy Week', seasonFor('2026-03-29'), 'holy-week');
eq('Good Friday 2026 is Holy Week', seasonFor('2026-04-03'), 'holy-week');
eq('Easter Sunday 2026', seasonFor('2026-04-05'), 'easter');
eq('Easter week ends on the Saturday', [seasonFor('2026-04-11'), seasonFor('2026-04-12')], ['easter', 'ordinary']);
eq('Pentecost 2026 (24 May)', seasonFor('2026-05-24'), 'pentecost');
eq('Thanksgiving week 2026 starts the Sunday before', [seasonFor('2026-11-21'), seasonFor('2026-11-22')],
   ['ordinary', 'thanksgiving']);
eq('Thanksgiving week 2026 ends the Saturday after', seasonFor('2026-11-28'), 'thanksgiving');
eq('Advent 2026 starts the next day', seasonFor('2026-11-29'), 'advent');
eq('Christmas Eve is still Advent', seasonFor('2026-12-24'), 'advent');
eq('Christmas Day', seasonFor('2026-12-25'), 'christmas');
eq('Twelfth Night is Christmas', seasonFor('2027-01-05'), 'christmas');
eq('Epiphany is ordinary', seasonFor('2027-01-06'), 'ordinary');
// 2028: Advent begins Dec 3, Thanksgiving is the 23rd — the gap between them.
eq('the Sunday between Thanksgiving week and Advent 2028', seasonFor('2028-11-26'), 'ordinary');
// 2029: Thanksgiving on the 22nd, the earliest; its week is 18–24 Nov.
eq('Thanksgiving week 2029', [seasonFor('2029-11-18'), seasonFor('2029-11-24'), seasonFor('2029-11-25')],
   ['thanksgiving', 'thanksgiving', 'ordinary']);

/* ==== the bulletin's week ================================================= */

eq('this Sunday', bulletinWhen('2026-10-25', '2026-10-25'), 'today');
eq('next Sunday, seen on Thursday', bulletinWhen('2026-11-01', '2026-10-29'), 'upcoming');
eq('last Sunday, seen on Saturday', bulletinWhen('2026-10-25', '2026-10-31'), 'recent');
eq('a Sunday a week gone is stale', bulletinWhen('2026-10-18', '2026-10-25'), 'stale');

/* ==== events ============================================================== */

const ev = (title: string, start: string, lastDay: string, allDay = false): LobbyEvent => ({
  title, start, lastDay, allDay, multiDay: start.slice(0, 10) !== lastDay.slice(0, 10), when: '',
  dateBlock: { month: '', day: '', isRange: false }, location: null, description: null, url: null,
});
const now = new Date('2026-10-28T16:00:00Z');   // Wednesday noon at church
eq('finished events drop off; all-day ones last the whole day', upcomingEvents([
  ev('yesterday', '2026-10-27T23:00:00Z', '2026-10-27T23:59:59Z'),
  ev('today all day', '2026-10-28T00:00:00Z', '2026-10-28T00:00:00Z', true),
  ev('tonight', '2026-10-28T23:00:00Z', '2026-10-28T23:59:59Z'),
  ev('revival, half done', '2026-10-25T23:00:00Z', '2026-10-30T23:59:59Z'),
], now, '2026-10-28').map((e) => e.title), ['today all day', 'tonight', 'revival, half done']);

/* ==== scenes ============================================================== */

const feed = (over: Partial<LobbyFeed['bulletin']> = {}, events: LobbyEvent[] = []): LobbyFeed => ({
  generatedAt: '', churchName: 'Fairhaven Community Church', address: '', serviceTimes: [],
  events, links: { site: '', livestream: '', events: '', visit: '', give: '', guest: '' }, qr: {}, heroes: [], copy: {},
  bulletin: {
    serviceDate: '2026-10-25', title: 'Morning Worship', preacher: 'Pastor Reeve',
    announcements: [{ when: 'Sunday', heading: 'Lunch', detail: '' }, { when: '', heading: 'Choir', detail: '' }],
    prayerRequests: Array.from({ length: 8 }, (_, i) => `Request ${i}`),
    scripture: 'For God so loved the world', scriptureRef: 'John 3:16', isCurrent: true,
    celebrations: { month: 'October', birthdays: [{ day: 3, name: 'Ada' }], anniversaries: [] },
    singing: null, signups: [], ...over,
  },
});
const ctxAt = (c: ClockParts, instant = '2026-10-25T13:40:00Z') =>
  ({ now: new Date(instant), clock: c, phase: phaseAt(c), lap: 0 });
const kinds = (list: { kind: string }[]) => list.map((s) => s.kind);

const before = scenesFor('programme', feed(), ctxAt(SUN(9, 40)));
eq('before a service opens with the welcome, New Here, then the text', kinds(before).slice(0, 3), ['welcome', 'guest', 'text']);
eq('before a service shows every announcement', before.filter((s) => s.kind === 'announcement').length, 2);
eq(`prayer requests page at ${PRAYER_PER_PAGE}`, before.filter((s) => s.kind === 'prayer').map((s) => s.idx),
   [[0, 1, 2, 3, 4, 5], [6, 7]]);
eq('birthdays are shown', kinds(before).includes('celebrations'), true);
eq('the celebrations scene knows which are birthdays', before.find((s) => s.kind === 'celebrations')?.split, 1);
eq('no singing scene without a singing schedule', kinds(before).includes('singing'), false);
// No scene is ever just a photograph with a caption (the pastor, 2026-10-22).
eq('there is no photo-only scene', kinds(before).includes('photo' as never), false);
eq('but photographs sit behind the scenes', before.filter((s) => s.photo != null).length > 3, true);
eq('scene keys are unique', new Set(before.map((s) => s.key)).size, before.length);

// The last five minutes hold one scene: the room needs to move, not read.
eq('9:54 is still the full programme', kinds(scenesFor('programme', feed(), ctxAt(SUN(9, 54))))[0], 'welcome');
eq('9:55 holds on "starting"', kinds(scenesFor('programme', feed(), ctxAt(SUN(9, 55)))), ['starting']);
eq('17:26 holds before Evening Worship', kinds(scenesFor('programme', feed(), ctxAt(SUN(17, 26)))), ['starting']);
eq('16:28 is not a hold: Sunday School is not counted', kinds(scenesFor('programme', feed(), ctxAt(SUN(16, 28)))).includes('starting'), false);
eq('16:45 is the welcome for Evening Worship', kinds(scenesFor('programme', feed(), ctxAt(SUN(16, 45))))[0], 'welcome');

eq('during a service: one quiet scene', kinds(scenesFor('programme', feed(), ctxAt(SUN(10, 30)))), ['quiet']);
eq('at night: the dim clock', kinds(scenesFor('programme', feed(), ctxAt(SUN(23)))), ['night']);
eq('after a service opens with thanks', kinds(scenesFor('programme', feed(), ctxAt(SUN(11, 45))))[0], 'thanks');

// A stale bulletin shows nothing of itself.
const stale = scenesFor('programme', feed({ serviceDate: '2026-10-11' }), ctxAt(SUN(9, 40)));
eq('a stale bulletin contributes nothing', kinds(stale).filter((k) =>
   ['text', 'announcement', 'prayer', 'celebrations'].includes(k)), []);
// Next Sunday's bulletin, published early, is previewed on a weekday.
const thu = at('2026-10-29', 4, 12);
const weekday = scenesFor('programme', feed({ serviceDate: '2026-11-01' }), ctxAt(thu, '2026-10-29T16:00:00Z'));
eq('a weekday previews next Sunday', kinds(weekday).includes('next-sunday'), true);
eq('a weekday opens with the service times', kinds(weekday)[0], 'services');

// No bulletin and no events: never an empty screen.
const empty = scenesFor('programme', { ...feed(), bulletin: null }, ctxAt(SUN(9, 40)));
eq('no bulletin still has a welcome', kinds(empty)[0], 'welcome');
eq('the events channel with nothing in it falls back to the service times',
   kinds(scenesFor('events', { ...feed(), bulletin: null }, ctxAt(thu))), ['services']);

const weekEvents = [
  ev('Prayer', '2026-10-29T23:00:00Z', '2026-10-29T23:59:59Z'),
  ev('Picnic', '2026-10-31T00:00:00Z', '2026-10-31T00:00:00Z', true),
  ev('Far off', '2026-11-20T23:00:00Z', '2026-11-20T23:59:59Z'),
];
const wk = scenesFor('week', feed({}, weekEvents), ctxAt(thu, '2026-10-29T16:00:00Z'));
eq('this week lists only the next seven days', wk.find((s) => s.kind === 'events')?.idx, [0, 1]);
const coming = scenesFor('events', feed({}, weekEvents), ctxAt(thu, '2026-10-29T16:00:00Z'));
eq('coming up lists them all', coming.find((s) => s.kind === 'events')?.idx, [0, 1, 2]);

eq('down from the programme is Today', stepChannel('programme', 1), 'today');
eq('up from the programme is Coming up', stepChannel('programme', -1), 'events');

// The bulletin's "Coming Up" — past this week, at most twelve — is in the
// programme too, not only on the remote's channel.
const lots = [...weekEvents, ...Array.from({ length: 14 }, (_, i) =>
  ev(`Later ${i}`, `2026-11-${String(10 + i).padStart(2, '0')}T23:00:00Z`, `2026-11-${String(10 + i).padStart(2, '0')}T23:59:59Z`))];
const laterIdx = (list: Scene[]) => list.filter((s) => s.key.startsWith('later')).flatMap((s) => s.idx ?? []);
const wkLots = scenesFor('programme', feed({}, lots), ctxAt(thu, '2026-10-29T16:00:00Z'));
eq('a weekday shows this week, then coming up', kinds(wkLots).filter((k) => k === 'events').length > 1, true);
eq('coming up leaves out this week', laterIdx(wkLots).includes(0) || laterIdx(wkLots).includes(1), false);
eq(`coming up stops at ${COMING_UP_MAX}, as the bulletin does`, laterIdx(wkLots).length, COMING_UP_MAX);
eq('coming up is before a service too', laterIdx(scenesFor('programme', feed({}, lots), ctxAt(SUN(9, 40)))).length > 0, true);
eq('and after one', laterIdx(scenesFor('programme', feed({}, lots), ctxAt(SUN(11, 45)))).length > 0, true);
eq('every programme scene key is still unique', new Set(wkLots.map((s) => s.key)).size, wkLots.length);

/* ==== "Missed last Sunday?" =============================================== */

const sermon = (date: string): LobbySermon => ({ title: 'Jesus: Our Jubilee', speaker: 'Bro. Daniel Whitfield',
  scripture: 'Isaiah 61:1-2', date, url: 'https://yourchurch.org/sermons/x', hasTranscript: true });
eq('the next Sunday morning, it is last Sunday', sermonWhen(sermon('2026-10-18'), '2026-10-25'), 'last');
eq('the Thursday after, still last Sunday', sermonWhen(sermon('2026-10-18'), '2026-10-22'), 'last');
eq('on the day itself, this morning', sermonWhen(sermon('2026-10-25'), '2026-10-25'), 'today');
eq('a week on Monday it has been overtaken', sermonWhen(sermon('2026-10-18'), '2026-10-26'), null);
eq('no sermon, no scene', sermonWhen(null, '2026-10-25'), null);
const withSermon = (date: string) => ({ ...feed(), sermon: sermon(date) });
eq('a weekday shows last Sunday’s sermon', kinds(scenesFor('programme', withSermon('2026-10-25'), ctxAt(thu, '2026-10-29T16:00:00Z'))).includes('sermon'), true);
eq('so does Sunday morning, before the service', kinds(scenesFor('programme', withSermon('2026-10-18'), ctxAt(SUN(9, 40)))).includes('sermon'), true);
eq('an old sermon is left out', kinds(scenesFor('programme', withSermon('2026-10-11'), ctxAt(SUN(9, 40)))).includes('sermon'), false);
eq('it can be switched off', kinds(scenesFor('programme', { ...withSermon('2026-10-18'), settings: { pace: 1, hidden: ['sermon'], notice: null, hiddenPhotos: [] } },
  ctxAt(SUN(9, 40)))).includes('sermon'), false);
eq('the switch is on the Lobby tab', HIDEABLE.some((h) => h.kind === 'sermon'), true);
eq('down from Coming up wraps to Today', stepChannel('events', 1), 'today');

const photosFor = (serviceDate: string) =>
  scenesFor('programme', feed({ serviceDate }), { ...ctxAt(SUN(9, 40)), clock: { ...SUN(9, 40), date: serviceDate } }).map((s) => s.photo);
eq('so the scenes get different photographs week to week', JSON.stringify(photosFor('2026-10-25')) !== JSON.stringify(photosFor('2026-11-01')), true);

/* ==== the standing invitations: Give and New Here ======================== */

const inviteKinds = (list: { kind: string }[]) => list.filter((s) => s.kind === 'give' || s.kind === 'guest').map((s) => s.kind);
eq('before a service: New Here early, Give at the end',
   [kinds(before).indexOf('guest'), kinds(before).at(-1)], [1, 'give']);
eq('after a service: both', inviteKinds(scenesFor('programme', feed(), ctxAt(SUN(11, 45)))), ['guest', 'give']);
eq('a weekday: both', inviteKinds(weekday).sort(), ['give', 'guest']);
eq('with no bulletin at all, both still run',
   inviteKinds(scenesFor('programme', { ...feed(), bulletin: null }, ctxAt(SUN(9, 40)))), ['guest', 'give']);
eq('not during a service', inviteKinds(scenesFor('programme', feed(), ctxAt(SUN(10, 30)))), []);
eq('they hold long enough to get a phone out', before.find((s) => s.kind === 'give')?.seconds, INVITE_SECONDS);
const giveScene = before.find((s) => s.kind === 'give')!;
eq('Give sits on one of its own photographs', INVITE_PHOTOS.give.includes(screenPhotos(feed())[giveScene.photo!]!.key), true);
eq('New Here on one of its own', INVITE_PHOTOS.guest.includes(screenPhotos(feed())[before.find((s) => s.kind === 'guest')!.photo!]!.key), true);
eq('every invite photograph exists', [...INVITE_PHOTOS.give, ...INVITE_PHOTOS.guest].every((f) => LOBBY_PHOTOS.some((p) => p.file === f)), true);
const giveLap = (lap: number) => scenesFor('programme', feed(), { ...ctxAt(SUN(9, 40)), lap }).find((s) => s.kind === 'give')!.photo;
eq('and moves to the next of them each lap', giveLap(0) !== giveLap(1), true);

/* ==== reading time and material ========================================== */

eq('a short scene still gets eight seconds', dwellSeconds('Lunch'), 8);
// 20 words at two a second, plus four to settle.
eq('twenty words get fourteen seconds', dwellSeconds(Array.from({ length: 20 }, () => 'word').join(' ')), 14);
eq('nothing stays more than 24 seconds', dwellSeconds('word '.repeat(200)), 24);
eq('missing pieces count as nothing', dwellSeconds(null, undefined, 'one two'), 8);
eq('the scripture scene is timed by its words', before.find((s) => s.kind === 'text')?.seconds,
   dwellSeconds('For God so loved the world', 'John 3:16', 'Pastor Reeve'));
eq('light glass on Sunday morning', materialFor(SUN(9, 40)), 'light');
eq('smoked glass for the evening service', materialFor(SUN(17, 0)), 'dark');
eq('smoked glass before dawn', materialFor(SUN(5, 59)), 'dark');

/* ==== celebrations ======================================================= */

// Seven to a column, birthdays first, anniversaries in a column of their own,
// three columns to a page.
eq('a small month is one page', celebrationPages(5, 3).map((p) => [p.b.length, p.a.length]), [[5, 3]]);
eq('eleven birthdays and five anniversaries fill three columns', celebrationPages(11, 5).map((p) => [p.b.length, p.a.length]), [[11, 5]]);
eq('a busy month spills onto a second page', celebrationPages(20, 6).map((p) => [p.b.length, p.a.length]), [[20, 0], [0, 6]]);
eq('anniversaries never share a column with birthdays', celebrationPages(8, 2).map((p) => [p.b.length, p.a.length]), [[8, 2]]);
eq('and are numbered from their own list', celebrationPages(20, 6)[1]!.a, [0, 1, 2, 3, 4, 5]);
eq('no celebrations, no pages', celebrationPages(0, 0), []);

/* ==== hero frames ========================================================= */

const hero = (over: Partial<LobbyHero> = {}): LobbyHero => ({
  id: 1, image: '/api/lobby/hero/1', kicker: 'Saturday · December 5',
  title: 'Drive-thru Nativity', subtitle: 'An evening of carols on the lawn', corner: 'bottom-right',
  tone: 'dark', accent: 'red', titleStyle: 'serif', shade: 70, startsOn: null, endsOn: null, ...over,
});

eq('a valid frame passes, tidied', validateHero({ title: '  Drive-thru   Nativity ', corner: 'bottom-left', shade: '55' }),
   { ok: true, value: { kicker: '', title: 'Drive-thru Nativity', subtitle: '', shade: 55, startsOn: null, endsOn: null,
     corner: 'bottom-left', tone: 'dark', accent: 'red', titleStyle: 'serif' } });
eq('a title is required', validateHero({ title: '  ' }).ok, false);
eq('an over-long title is refused, not cut', validateHero({ title: 'x'.repeat(49) }).ok, false);
// The top corners belong to the logo and the clock bar.
eq('a top corner is refused', validateHero({ title: 'Revival', corner: 'top-right' }).ok, false);
eq('shade is held to 0–100', (validateHero({ title: 'A', shade: 400 }) as { value: { shade: number } }).value.shade, 100);
eq('dates must be dates', validateHero({ title: 'A', startsOn: 'next week' }).ok, false);
eq('the last day cannot come before the first', validateHero({ title: 'A', startsOn: '2026-12-05', endsOn: '2026-12-01' }).ok, false);
// One image, sharp from its first frame: the blurred placeholder read as
// pixelation on a TV, not as a focus pull (the pastor, 2026-10-22).
eq('the frame draws exactly one image', (heroHtml(hero()).match(/<img/g) ?? []).length, 1);

eq('frames are shown from their first day to their last, inclusive',
   ['2026-11-30', '2026-12-01', '2026-12-05', '2026-12-06'].map((d) =>
     heroesFor([hero({ startsOn: '2026-12-01', endsOn: '2026-12-05' })], d).length), [0, 1, 1, 0]);
eq('open-ended frames are always due', heroesFor([hero()], '2030-01-01').length, 1);

eq('a short title is set large', heroTitleSize('Revival', 'serif'), 172);
eq('a long one smaller', heroTitleSize('An Evening of Carols and Candlelight', 'serif'), 104);
eq('the bold face is set smaller than the serif', heroTitleSize('Revival', 'bold') < heroTitleSize('Revival', 'serif'), true);
const html = heroHtml(hero({ title: '<b>Revival</b> & more', kicker: '"Fall"' }));
eq('the frame escapes what it is given', html.includes('<b>') || html.includes('"Fall"'), false);
eq('each title word gets its own mask', (html.match(/class="hw"/g) ?? []).length, 3);
eq('no kicker, no rule', heroHtml(hero({ kicker: '' })).includes('hero-rule'), false);

// In the programme.
const withHero = (h: LobbyHero[]) => ({ ...feed({ announcements: Array.from({ length: 5 }, (_, i) => ({ when: '', heading: `Note ${i}`, detail: '' })) }), heroes: h });
const heroBefore = scenesFor('programme', withHero([hero()]), ctxAt(SUN(9, 40)));
eq('a hero frame follows the welcome', kinds(heroBefore).slice(0, 2), ['welcome', 'hero']);
eq('and stays longer than anything else', heroBefore.find((s) => s.kind === 'hero')?.seconds, HERO_SECONDS);
eq('a long cycle shows it again halfway', heroBefore.filter((s) => s.kind === 'hero').length, 2);
eq('a short cycle shows it once', scenesFor('programme', { ...feed({ announcements: [], prayerRequests: [] }), heroes: [hero()] }, ctxAt(SUN(9, 40)))
   .filter((s) => s.kind === 'hero').length, 1);
eq('its two appearances have different keys', new Set(heroBefore.filter((s) => s.kind === 'hero').map((s) => s.key)).size, 2);
eq('not during a service', kinds(scenesFor('programme', withHero([hero()]), ctxAt(SUN(10, 30)))), ['quiet']);
eq('not in the last five minutes', kinds(scenesFor('programme', withHero([hero()]), ctxAt(SUN(9, 57)))), ['starting']);
eq('not at night', kinds(scenesFor('programme', withHero([hero()]), ctxAt(SUN(23)))), ['night']);
eq('a frame out of its dates is not shown',
   kinds(scenesFor('programme', withHero([hero({ endsOn: '2026-10-01' })]), ctxAt(SUN(9, 40)))).includes('hero'), false);
eq('weekdays open with hero frames', kinds(scenesFor('programme', withHero([hero()]), ctxAt(thu, '2026-10-29T16:00:00Z')))[0], 'hero');

/* ==== the Lobby tab: photographs ========================================== */

const upload = (id: number, uses: ('give' | 'guest')[] = []) =>
  ({ id, src: `/api/lobby/photo/${id}`, alt: `Upload ${id}`, face: .45, uses });
const photoFeed = (hiddenPhotos: string[], photos = [] as ReturnType<typeof upload>[]) =>
  ({ ...feed(), photos, settings: { pace: 1, hidden: [], notice: null, hiddenPhotos } });
eq('all built-in photographs by default', screenPhotos(feed()).length, LOBBY_PHOTOS.length);
eq('a switched-off one leaves the rotation', screenPhotos(photoFeed(['kids-pew'])).some((p) => p.key === 'kids-pew'), false);
eq('uploads join after the built-in ones', screenPhotos(photoFeed([], [upload(7)])).at(-1)!.key, 'upload-7');
eq('switching everything off brings the built-in set back, never a blank wall',
   screenPhotos(photoFeed(LOBBY_PHOTOS.map((p) => p.file))).length, LOBBY_PHOTOS.length);
eq('…unless an upload is on, which then carries the screen alone',
   screenPhotos(photoFeed(LOBBY_PHOTOS.map((p) => p.file), [upload(3)])).map((p) => p.key), ['upload-3']);
const scenesOnlyUploads = scenesFor('programme', photoFeed(LOBBY_PHOTOS.map((p) => p.file), [upload(3), upload(4, ['give'])]), ctxAt(SUN(9, 40)));
eq('every scene then sits on an upload', scenesOnlyUploads.filter((x) => x.photo != null).every((x) => x.photo! < 2), true);
eq('an upload marked for Give is used behind Give', scenesOnlyUploads.find((x) => x.kind === 'give')!.photo, 1);
eq('with all of Give\'s own set off, Give still gets a photograph',
   scenesFor('programme', photoFeed(INVITE_PHOTOS.give), ctxAt(SUN(9, 40))).find((x) => x.kind === 'give')!.photo != null, true);
eq('photo switches survive a save of the other settings',
   (cleanSettings({ pace: 1, hidden: [], notice: null, hiddenPhotos: ['kids-pew', 'Bad Name!'] }) as { value: LobbySettings }).value.hiddenPhotos, ['kids-pew']);
eq('the shuffle covers whatever is in rotation', sorted(photoOrder('2026-10-25', 5)), [0, 1, 2, 3, 4]);

/* ==== the Lobby tab: words ================================================ */

const allFields = COPY_SECTIONS.flatMap((x) => x.fields);
eq('every phrase has a unique key', new Set(allFields.map((f) => f.key)).size, allFields.length);
eq('every default fits its own limit', allFields.filter((f) => f.default.length > f.max).map((f) => f.key), []);
eq('a default is used when nothing is saved', copyText({}, 'prayer.label'), 'Please pray for');
eq('a saved phrase replaces it', copyText({ 'prayer.label': 'Pray with us for' }, 'prayer.label'), 'Pray with us for');
eq('placeholders are filled', copyText({}, 'celebrations.birthdays', { month: 'October' }), 'October birthdays');
eq('an unknown key shows itself, not a blank', copyText({}, 'nope.key'), 'nope.key');
eq('only changed phrases are kept', cleanCopy({ 'give.label': 'Give', 'give.head': '  Every   gift matters ', 'nope': 'x' }),
   { ok: true, value: { 'give.head': 'Every gift matters' } });
eq('clearing a field restores the default', cleanCopy({ 'give.head': '' }), { ok: true, value: {} });
eq('too long is refused, not cut', cleanCopy({ 'give.label': 'x'.repeat(31) }).ok, false);
eq('a placeholder the phrase does not offer is refused', cleanCopy({ 'prayer.label': 'Pray for {month}' }).ok, false);
eq('…and one it does is allowed', cleanCopy({ 'celebrations.birthdays': 'Birthdays in {month}' }).ok, true);
eq('a damaged saved row is no words', parseCopy('{not json'), {});
eq('saved words for keys that no longer exist are ignored', parseCopy('{"gone.key":"x","give.label":"Gifts"}'), { 'give.label': 'Gifts' });

/* ==== the Lobby tab: pace, switched-off scenes, notice ==================== */

eq('settings default to standard pace, nothing hidden, no notice', parseSettings(null), { pace: 1, hidden: [], notice: null, hiddenPhotos: [] });
eq('an odd pace is refused', cleanSettings({ pace: 7 }).ok, false);
eq('unknown scene types cannot be hidden', (cleanSettings({ pace: 1, hidden: ['give', 'welcome', 'nonsense'] }) as { value: { hidden: string[] } }).value.hidden, ['give']);
eq('the welcome, hold, quiet and night scenes are never hideable',
   HIDEABLE.some((h) => ['welcome', 'starting', 'quiet', 'night'].includes(h.kind)), false);
eq('a notice with no words is no notice', (cleanSettings({ pace: 1, notice: { title: '  ', detail: 'x' } }) as { value: { notice: unknown } }).value.notice, null);
eq('a too-long notice is refused', cleanSettings({ pace: 1, notice: { title: 'x'.repeat(61) } }).ok, false);
eq('a notice is up until its time', [noticeLive({ title: 'A', detail: '', until: '2026-10-25T15:00:00.000Z' }, new Date('2026-10-25T14:59:00Z')),
   noticeLive({ title: 'A', detail: '', until: '2026-10-25T15:00:00.000Z' }, new Date('2026-10-25T15:00:00Z'))], [true, false]);

const withSettings = (settings: Omit<LobbySettings, 'hiddenPhotos'> & { hiddenPhotos?: string[] }) =>
  ({ ...feed(), settings: { hiddenPhotos: [], ...settings } });
const slow = scenesFor('programme', withSettings({ pace: 1.5, hidden: [], notice: null }), ctxAt(SUN(9, 40)));
eq('pace scales every scene', slow.find((x) => x.kind === 'give')!.seconds, Math.round(INVITE_SECONDS * 1.5));
eq('…keeping their proportions', slow.find((x) => x.kind === 'welcome')!.seconds < slow.find((x) => x.kind === 'give')!.seconds, true);
const noBirthdays = scenesFor('programme', withSettings({ pace: 1, hidden: ['celebrations', 'give'], notice: null }), ctxAt(SUN(9, 40)));
eq('a hidden scene type is left out', kinds(noBirthdays).filter((k) => k === 'celebrations' || k === 'give'), []);
eq('the rest carries on', kinds(noBirthdays)[0], 'welcome');
const everything = HIDEABLE.map((h) => h.kind);
eq('hiding everything on a weekday still leaves the service times',
   kinds(scenesFor('programme', withSettings({ pace: 1, hidden: everything, notice: null }), ctxAt(thu, '2026-10-29T16:00:00Z'))), ['services']);
const notice = { title: 'Fellowship meal moved to 12:30', detail: '', until: '2026-10-25T16:00:00.000Z' };
eq('a notice comes straight after the welcome',
   kinds(scenesFor('programme', withSettings({ pace: 1, hidden: [], notice }), ctxAt(SUN(9, 40)))).slice(0, 2), ['welcome', 'notice']);
eq('and comes down at its time',
   kinds(scenesFor('programme', withSettings({ pace: 1, hidden: [], notice }), ctxAt(SUN(11, 45), '2026-10-25T16:45:00Z'))).includes('notice'), false);

/* ==== housekeeping ======================================================== */

eq('reloads at 3am after a long uptime', shouldReload(at('2026-10-29', 4, 3, 2), 5 * 3600_000), true);
eq('not straight after the reload itself', shouldReload(at('2026-10-29', 4, 3, 2), 60_000), false);
eq('not at 3pm', shouldReload(at('2026-10-29', 4, 15, 2), 5 * 3600_000), false);

/* ==== QR codes ============================================================ */

const qr = qrFor('https://yourchurch.org/livestream');
eq('a QR code is a square grid of modules', qr.n >= 21 && (qr.n - 17) % 4 === 0, true);
// The top-left finder pattern: a 7-wide solid run on row 0.
eq('the finder pattern is drawn', qr.d.startsWith('M0 0h7v1h-7z'), true);
eq('a remembered code is the same code', qrFor('https://yourchurch.org/livestream'), qr);

// ---- the change stamp: same inputs, same stamp; any change, a new one ----
const base = '2026-10-24|8.2026-10-24T23:46:14.362Z|4.2026-10-22T21:31:04.232Z|0.|1.x|lobby_copy@x';
eq('the stamp is stable', stampOf(base), stampOf(base));
eq('a newly published bulletin changes it', stampOf(base) === stampOf(base.replace('8.2026-10-24T23:46:14.362Z', '9.2026-10-25T01:00:00.000Z')), false);
eq('a new day changes it', stampOf(base) === stampOf(base.replace('2026-10-24|', '2026-10-25|')), false);
eq('it is short and URL-safe', /^[0-9a-z]{1,7}$/.test(stampOf(base)), true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
