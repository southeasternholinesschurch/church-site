/**
 * The lobby screen: a Samsung Frame in the foyer, running one web page that
 * nobody touches most Sundays.
 *
 * Everything here is the screen's JUDGEMENT — what time it is at the church,
 * whether a service is about to start, is on, or has just ended, which church
 * season it is, and what to show as a result. It is shared by the page's
 * script (bundled for the browser) and by test/lobby.test.ts (plain Node), so
 * it is pure: no `astro:` imports, no database, no DOM, and explicit `.ts`
 * import extensions, as in bulletin.ts.
 *
 * The clock is the hard part, for the same reason it is everywhere else in
 * this app: the TV box may be set to any timezone, and the church's is the
 * only one that matters. Every "what time is it" goes through clockParts.
 */
import { CHURCH_TZ } from './services.ts';
import type { PublicBulletin } from './bulletin.ts';
import { heroesFor, HERO_SECONDS, type LobbyHero } from './lobby-heroes.ts';
import { noticeLive, type LobbySettings } from './lobby-settings.ts';

/* ==== the feed ============================================================ */

export interface ServiceTime { label: string; day: string; time: string }

/** One event from the site's /events.json, already formatted by the site. */
export interface LobbyEvent {
  title: string;
  start: string;
  lastDay: string;
  allDay: boolean;
  multiDay: boolean;
  /** "Sunday 25 Oct · 10:00 AM" — the website's own wording. */
  when: string;
  dateBlock: { month: string; day: string; isRange: boolean };
  location: string | null;
  description: string | null;
  url: string | null;
}

/** The most recent Sunday-morning sermon on the website, from events.json. */
export interface LobbySermon {
  title: string;
  speaker: string | null;
  scripture: string | null;
  /** The service's date, YYYY-MM-DD. */
  date: string;
  /** Its page on the website: the video, and the transcript when there is one. */
  url: string;
  hasTranscript: boolean;
}

/** A QR code as an SVG path on an n×n grid of modules. Drawn server-side. */
export interface QrCode { n: number; d: string }

/** What /api/lobby/feed returns. */
export interface LobbyFeed {
  generatedAt: string;
  /** What changed-or-not is measured against; the screen sends it back as `?since=`. */
  stamp?: string;
  churchName: string;
  address: string;
  serviceTimes: ServiceTime[];
  bulletin: PublicBulletin | null;
  events: LobbyEvent[];
  /** Last Sunday morning's sermon, if the website has one. */
  sermon?: LobbySermon | null;
  /** `give` is the Zeffy form; `guest` the guest card (/welcome on the site). */
  links: { site: string; livestream: string; events: string; visit: string; give: string; guest: string };
  /** Keyed by URL, for every link the screen may show. */
  qr: Record<string, QrCode>;
  /** Active hero frames not yet past their last day; the screen picks today's. */
  heroes: LobbyHero[];
  /** The screen's words as changed on the Lobby tab; see lib/lobby-copy.ts. */
  copy: Record<string, string>;
  /** Pace, hidden scene types and the notice; see lib/lobby-settings.ts. */
  settings?: LobbySettings;
  /** Photographs uploaded on the Lobby tab and switched on. */
  photos?: UploadedPhoto[];
}

/* ==== the photographs the screen may use ================================== */

/** An uploaded photograph, as the feed carries it. */
export interface UploadedPhoto {
  id: number;
  src: string;
  alt: string;
  /** Where the faces are, as a fraction of the height (see PHOTO_FACES). */
  face: number;
  /** Which invitations it may sit behind. */
  uses: ('give' | 'guest')[];
}

/** One photograph as the screen uses it, built in or uploaded. */
export interface ScreenPhoto {
  key: string;
  src: string;
  alt: string;
  pos?: string;
  face: number;
  uses: ('give' | 'guest')[];
}

export function builtInPhotos(): ScreenPhoto[] {
  return LOBBY_PHOTOS.map((p) => ({
    key: p.file, src: `/lobby-photos/${p.file}.jpg`, alt: p.alt, pos: p.pos, face: PHOTO_FACES[p.file] ?? .45,
    uses: (['give', 'guest'] as const).filter((k) => INVITE_PHOTOS[k].includes(p.file)),
  }));
}

/**
 * The photographs in rotation: the built-in ones not switched off on the
 * Lobby tab, then the uploaded ones switched on. Scene.photo is an index into
 * THIS list, and the screen builds the same list from the same feed.
 *
 * Never empty: if every photograph has been switched off, the built-in set
 * comes back rather than the screen running on a blank background.
 */
export function screenPhotos(feed: Pick<LobbyFeed, 'photos' | 'settings'>): ScreenPhoto[] {
  const hidden = new Set(feed.settings?.hiddenPhotos ?? []);
  const list = [
    ...builtInPhotos().filter((p) => !hidden.has(p.key)),
    ...(feed.photos ?? []).map((u) => ({ key: `upload-${u.id}`, src: u.src, alt: u.alt, face: u.face, uses: u.uses })),
  ];
  return list.length ? list : builtInPhotos();
}

/**
 * The service times if the site's events.json cannot be reached.
 *
 * A copy of site.yaml's list, kept here so the screen still knows when church
 * is when the website is down. site.yaml remains the source: the feed sends
 * the live list whenever it can, and this is only the fallback.
 */
export const FALLBACK_SERVICE_TIMES: ServiceTime[] = [
  { label: 'Sunday Morning Worship', day: 'Sunday', time: '10:00' },
  { label: 'Sunday School', day: 'Sunday', time: '16:30' },
  { label: 'Sunday Evening Worship', day: 'Sunday', time: '17:30' },
  { label: 'Wednesday Prayer & Praise', day: 'Wednesday', time: '19:00' },
];

/* ==== the photographs ===================================================== */

/**
 * The photographs the screen cycles through, in app/public/lobby-photos/.
 *
 * CHILDREN'S PHOTOS ARE HERE ON PURPOSE. The pastor, 2026-10-22: "People want to see
 * their kids. We are a small church, people love the children and love seeing
 * their pics." That deliberately differs from the check-in kiosk, which shows
 * no photographs (the pastor, 2026-09-08) — the kiosk is a scan screen where a face
 * would be a confirmation of identity; this is the church's own family album
 * on the foyer wall. Do not "fix" one to match the other.
 *
 * `pos` is the CSS object-position that keeps the subject in a 16:9 frame,
 * since every original is 3:2. ladies-talking and preaching-hand are left
 * out: they are portrait and crop to a stranger's elbow at 16:9.
 */
export interface LobbyPhoto { file: string; alt: string; pos?: string }
export const LOBBY_PHOTOS: LobbyPhoto[] = [
  { file: 'congregation', alt: 'The congregation gathered for Sunday morning worship' },
  { file: 'kids-pew', alt: 'Children leaning over a pew, smiling', pos: '50% 40%' },
  { file: 'worship', alt: 'The sanctuary during a Sunday service' },
  { file: 'fellowship', alt: 'Members talking together after the service', pos: '50% 35%' },
  { file: 'kids-raised', alt: 'Children with hands raised during worship', pos: '50% 35%' },
  { file: 'exterior', alt: 'Fairhaven Community Church from the lawn' },
  { file: 'kids-pews', alt: 'Children listening together during Fairhaven Kids', pos: '50% 30%' },
  { file: 'hands-raised', alt: 'Congregation with hands raised in worship' },
  { file: 'kids-singing', alt: 'Young people singing together during the service' },
  { file: 'seniors-conversation', alt: 'Laughing together in the foyer', pos: '50% 30%' },
  { file: 'guitar', alt: 'Singing with the children around the guitar' },
  { file: 'youth-row', alt: 'Fairhaven Youth together in a row of pews' },
  { file: 'kids-guitar', alt: 'A child listening to the guitar' },
  { file: 'sanctuary', alt: 'The sanctuary, from the back' },
  { file: 'kids-seated', alt: 'Children seated together at Fairhaven Kids' },
  { file: 'talking', alt: 'Friends catching up after the service', pos: '50% 30%' },
  { file: 'kids-hand', alt: 'A child raising her hand in worship', pos: '50% 30%' },
  { file: 'luther', alt: 'Assistant Pastor Martin Hale preaching' },
  { file: 'standing', alt: 'Members of the congregation standing to sing' },
  { file: 'sent-men', alt: 'The men of the church talking together', pos: '50% 35%' },
  { file: 'hymnal', alt: 'Singing from the hymnal' },
  { file: 'pastor-pulpit', alt: 'Pastor Reeve at the pulpit' },
  { file: 'ladies-worship', alt: 'Raising hands in worship' },
  { file: 'exterior-wide', alt: 'The church building and lawn' },
  { file: 'prayer', alt: 'Praying together at the altar' },
  { file: 'teaching', alt: 'Teaching a class' },
  { file: 'pulpit', alt: 'The pulpit and the lit cross' },
];

/* ==== the church's clock ================================================== */

export interface ClockParts {
  /** YYYY-MM-DD at the church. */
  date: string;
  /** 0 = Sunday, at the church. */
  weekday: number;
  /** Minutes since the church's midnight. */
  minutes: number;
  seconds: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The wall clock at the church, whatever the TV box thinks its timezone is.
 * `hourCycle: 'h23'` because en-US with hour12:false still says "24:05" just
 * after midnight in some engines.
 */
export function clockParts(now: Date, tz: string = CHURCH_TZ): ClockParts {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday!),
    minutes: Number(p.hour) * 60 + Number(p.minute),
    seconds: Number(p.second),
  };
}

/**
 * "2026-10-25T09:40", read as church time, as an instant. For the `?at=`
 * preview helper, so a screenshot of "Sunday at 9:40" can be taken on a
 * Thursday afternoon from any timezone.
 *
 * Found by guessing UTC and correcting by the zone's offset, twice — the
 * second pass is what lands on the right side of a DST change. A wall time
 * that does not exist (2:30 on the spring-forward night) comes out an hour
 * later, which is what a clock on the wall would have said.
 */
export function zonedInstant(local: string, tz: string = CHURCH_TZ): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim());
  if (!m) return null;
  const wall = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!);
  let t = wall - offsetAt(wall, tz);
  t = wall - offsetAt(t, tz);
  return new Date(t);
}

/** How far the zone's wall clock is ahead of UTC at instant `t`, in ms. */
function offsetAt(t: number, tz: string): number {
  const c = clockParts(new Date(t), tz);
  const [y, mo, d] = c.date.split('-').map(Number);
  const wall = Date.UTC(y!, mo! - 1, d!, Math.floor(c.minutes / 60), c.minutes % 60, c.seconds);
  return wall - Math.floor(t / 1000) * 1000;
}

/** Calendar arithmetic on YYYY-MM-DD, at noon UTC so no DST can move a day. */
export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
}
export const weekdayOf = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

/** "17:30" → 1050; anything else → null. */
export function hhmm(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 1050 → "5:30 pm", 600 → "10:00 am" — site/src/lib/format.ts's clockText. */
export function clockText(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24, m = minutes % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/* ==== the programme: before, during, after ================================ */

/** How long before a service the screen starts counting down to it. */
export const BEFORE_MIN = 60;
/**
 * How long a service is assumed to last. A PLACEHOLDER — the pastor has not said,
 * and it is an open question in handoff/PLAN-lobby-screen.md.
 */
export const SERVICE_MIN = 90;
/** How long the "thank you for coming" programme runs afterwards. */
export const AFTER_MIN = 60;
/** The screen goes to a dim clock from 22:00 to 06:00. */
export const NIGHT_FROM = 22 * 60;
export const NIGHT_TO = 6 * 60;

export type Phase = 'before' | 'during' | 'after' | 'day' | 'night';

export interface Service { label: string; start: number; end: number }

/**
 * A day's services, in order, each with an end.
 *
 * A service ends SERVICE_MIN after it starts OR when the next one starts,
 * whichever is first. That clamp is the Sunday evening: Sunday School at 16:30
 * runs straight into Evening Worship at 17:30, and without it the two windows
 * would overlap and the screen would be "during" two services at once.
 */
export function servicesOn(weekday: number, times: ServiceTime[] = FALLBACK_SERVICE_TIMES): Service[] {
  const day = WEEKDAYS[weekday];
  const list = times
    .filter((t) => t.day.toLowerCase() === day!.toLowerCase())
    .map((t) => ({ label: t.label, start: hhmm(t.time) }))
    .filter((t): t is { label: string; start: number } => t.start !== null)
    .sort((a, b) => a.start - b.start);
  return list.map((s, i) => ({
    ...s,
    end: Math.min(s.start + SERVICE_MIN, list[i + 1]?.start ?? Infinity),
  }));
}

export interface PhaseAt {
  phase: Phase;
  /** The service the phase is about — the one starting, running or just ended. */
  service: Service | null;
  /** Minutes until `service` starts, for the countdown. Before only. */
  minutesToStart: number | null;
}

/**
 * Where the screen is in the day.
 *
 * Precedence is during > before > after > night > day, and it matters on a
 * Sunday evening: from 16:30 to 17:30 the screen is DURING Sunday School and
 * also BEFORE Evening Worship, and the room is full of people in a lesson —
 * so it stays quiet. "After Sunday School" is swallowed entirely, which is
 * right: there is no gap to fill; Evening Worship has started.
 */
/**
 * The services the screen counts down to and plans its day around: Sunday
 * morning, Sunday evening and Wednesday (the pastor, 2026-10-22: after the morning
 * service begins, "count down to the Sunday evening service ... after the
 * Sunday evening service begins, count down to the Wednesday night service").
 *
 * Sunday School is left out. It is a class, not a service the foyer waits
 * for, so it neither interrupts the countdown to Evening Worship nor makes a
 * "before" or "during" of its own: from 4:30 the screen is simply in the hour
 * before Evening Worship. The "Join us" scene still lists it.
 *
 * Matched on the label because site.yaml has no other way to say it. If a
 * rename ever left nothing to count, every service counts rather than none.
 */
export const isCountdownService = (t: ServiceTime): boolean => !/school/i.test(t.label);
export function countdownServices(times: ServiceTime[]): ServiceTime[] {
  const counted = times.filter(isCountdownService);
  return counted.length ? counted : times;
}

export function phaseAt(c: ClockParts, times: ServiceTime[] = FALLBACK_SERVICE_TIMES): PhaseAt {
  const today = servicesOn(c.weekday, countdownServices(times));
  const m = c.minutes;
  const during = today.find((s) => m >= s.start && m < s.end);
  if (during) return { phase: 'during', service: during, minutesToStart: null };
  const before = today.find((s) => m >= s.start - BEFORE_MIN && m < s.start);
  if (before) return { phase: 'before', service: before, minutesToStart: before.start - m };
  const after = [...today].reverse().find((s) => m >= s.end && m < s.end + AFTER_MIN);
  if (after) return { phase: 'after', service: after, minutesToStart: null };
  if (m >= NIGHT_FROM || m < NIGHT_TO) return { phase: 'night', service: null, minutesToStart: null };
  return { phase: 'day', service: null, minutesToStart: null };
}

export interface NextService { label: string; date: string; start: number; daysAway: number }

/**
 * The next counted service that has not started yet, looking up to a week
 * ahead. The moment one begins, this moves on to the one after — so the
 * countdown runs morning → evening → Wednesday → morning without a gap.
 */
export function nextService(c: ClockParts, times: ServiceTime[] = FALLBACK_SERVICE_TIMES): NextService | null {
  const counted = countdownServices(times);
  for (let i = 0; i <= 7; i++) {
    const date = addDays(c.date, i);
    const s = servicesOn((c.weekday + i) % 7, counted).find((x) => i > 0 || x.start > c.minutes);
    if (s) return { label: s.label, date, start: s.start, daysAway: i };
  }
  return null;
}

/**
 * Whole minutes from `now` until a service starts, as real elapsed time — so
 * a countdown across a DST change is an hour longer or shorter, as it should
 * be, rather than what the wall clocks suggest. Rounded up: "in 1 min" until
 * the minute it starts, never "in 0 min".
 */
export function minutesUntil(n: NextService, now: Date, tz: string = CHURCH_TZ): number {
  const h = Math.floor(n.start / 60), m = n.start % 60;
  const at = zonedInstant(`${n.date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, tz);
  return at ? Math.max(0, Math.ceil((at.getTime() - now.getTime()) / 60000)) : 0;
}

/**
 * A countdown in words that fit the clock bar: "18 min", "7 h 25 min",
 * "3 days, 1 h". Minutes are dropped past a day — nobody needs them on
 * Thursday — and nothing ever ticks by the second.
 */
export function countdownText(minutes: number): string {
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60), r = minutes % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }
  const d = Math.floor(minutes / 1440), h = Math.floor((minutes % 1440) / 60);
  return `${d} ${d === 1 ? 'day' : 'days'}${h ? `, ${h} h` : ''}`;
}

/**
 * The order the photographs appear in, shuffled — and the SAME shuffle all
 * week. The seed is the bulletin's service date, so a new bulletin brings a
 * new arrangement (the pastor, 2026-10-22: "randomize on generation of a new
 * bulletin"), while reloading the page or the feed refreshing mid-week does
 * not reshuffle what people have just seen. Within the week each lap of the
 * programme moves on through the order, so the backgrounds keep changing.
 *
 * FNV-1a to turn the seed into a number, mulberry32 to draw from it, and a
 * Fisher–Yates shuffle: small, dependency-free and identical on every box.
 */
export function photoOrder(seed: string, n: number = LOBBY_PHOTOS.length): number[] {
  let h = 2166136261;
  for (const ch of seed) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let s = h >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/** The last minutes before a service, when the screen stops rotating and
 *  holds one scene: "begins in 4 minutes, please make your way in". */
export const STARTING_MIN = 5;

/**
 * Light glass by day, smoked glass from late afternoon. The material follows
 * the room: a bright Sunday-morning foyer gets a bright screen, and an evening
 * service a darker one. Night has its own dim scene.
 */
export type Material = 'light' | 'dark';
export function materialFor(c: ClockParts): Material {
  return c.minutes >= 6 * 60 && c.minutes < 16 * 60 ? 'light' : 'dark';
}

/**
 * How long a scene stays up, from how much there is to read: 4 s to settle,
 * then about 120 words a minute (two a second), held between 8 and 24 s.
 * Signage guidance converges on that reading speed, and it means a short
 * announcement moves on while a page of prayer requests stays long enough to
 * read. See handoff/DESIGN-lobby-screen.md.
 */
export function dwellSeconds(...texts: (string | null | undefined)[]): number {
  const words = texts.join(' ').split(/\s+/).filter(Boolean).length;
  return Math.min(24, Math.max(8, Math.round(4 + words / 2)));
}

/* ==== church seasons ====================================================== */

export type Season =
  | 'ordinary' | 'advent' | 'christmas' | 'lent' | 'holy-week' | 'easter' | 'pentecost' | 'thanksgiving';

export const SEASON_LABEL: Record<Season, string> = {
  ordinary: '', advent: 'Advent', christmas: 'Christmas', lent: 'Lent', 'holy-week': 'Holy Week',
  easter: 'Easter', pentecost: 'Pentecost', thanksgiving: 'Thanksgiving',
};

/** Easter Sunday — the anonymous Gregorian computus (Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The first Sunday of Advent: the fourth Sunday before Christmas Day. */
export function adventSunday(year: number): string {
  const christmas = `${year}-12-25`;
  const w = weekdayOf(christmas);
  return addDays(christmas, -(w === 0 ? 7 : w) - 21);
}

/** US Thanksgiving: the fourth Thursday of November. */
export function thanksgiving(year: number): string {
  const first = weekdayOf(`${year}-11-01`);
  return addDays(`${year}-11-01`, ((4 - first + 7) % 7) + 21);
}

/**
 * The season a date falls in, for re-theming the screen.
 *
 * The windows are a Holiness church's, not a full liturgical calendar: Easter
 * and Pentecost are each a WEEK (the Sunday and the six days after), not the
 * fifty days of Eastertide — a congregation that does not keep the season
 * would find a month of Easter lilies odd. Christmas is the twelve days.
 * Thanksgiving is its Sunday-to-Saturday week. Nothing overlaps: Advent
 * always begins on the Sunday after Thanksgiving week at the earliest.
 */
export function seasonFor(date: string): Season {
  const year = Number(date.slice(0, 4));
  const easter = easterSunday(year);
  const e = daysBetween(easter, date);
  if (e >= -7 && e <= -1) return 'holy-week';
  if (e >= -46 && e <= -8) return 'lent';
  if (e >= 0 && e <= 6) return 'easter';
  if (e >= 49 && e <= 55) return 'pentecost';
  if (date >= `${year}-12-25` || date <= `${year}-01-05`) return 'christmas';
  if (date >= adventSunday(year)) return 'advent';
  const tg = daysBetween(thanksgiving(year), date);
  if (tg >= -4 && tg <= 2) return 'thanksgiving';
  return 'ordinary';
}

/* ==== the bulletin's week ================================================= */

/**
 * Whether the feed's bulletin is about today, an upcoming Sunday, the week
 * just gone, or something too old to show.
 *
 * A bulletin is still relevant through the week after its Sunday — its
 * prayer requests and announcements are this week's. A bulletin for a Sunday
 * more than six days ago is not: by then it is last week's news, and the feed
 * only returns it because nobody has published a newer one.
 */
export type BulletinWhen = 'today' | 'upcoming' | 'recent' | 'stale';
export function bulletinWhen(serviceDate: string, today: string): BulletinWhen {
  const d = daysBetween(today, serviceDate);
  if (d === 0) return 'today';
  if (d > 0) return 'upcoming';
  return d >= -6 ? 'recent' : 'stale';
}

/** Events that have not finished yet. An all-day event is a DATE (see the
 *  site's ical.ts), so it is compared as one, never as an instant. */
export function upcomingEvents(events: LobbyEvent[], now: Date, today: string): LobbyEvent[] {
  return events.filter((e) => e.allDay
    ? e.lastDay.slice(0, 10) >= today
    : Date.parse(e.lastDay) >= now.getTime() - 60 * 60000);
}

/**
 * Whether the website's latest sermon can honestly be called "last Sunday"
 * ("this morning" on the day itself). A sermon more than a week old has
 * been overtaken by a Sunday that is not posted yet, and the scene stays away
 * rather than offer an older one under that heading.
 */
export function sermonWhen(sermon: LobbySermon | null | undefined, today: string): 'today' | 'last' | null {
  if (!sermon) return null;
  const d = daysBetween(sermon.date, today);
  return d === 0 ? 'today' : d >= 1 && d <= 7 ? 'last' : null;
}

/** The bulletin's "Coming Up" lists at most this many events past this week. */
export const COMING_UP_MAX = 12;

/* ==== scenes ============================================================== */

/**
 * Channels, for the remote's up and down. The programme is not one of them:
 * it is what the screen does on its own, and Back (or a minute of nobody
 * touching anything) returns to it.
 */
export type Channel = 'programme' | 'today' | 'week' | 'events';
export const CHANNELS: Exclude<Channel, 'programme'>[] = ['today', 'week', 'events'];
export const CHANNEL_LABEL: Record<Channel, string> = {
  programme: 'Programme', today: 'Today', week: 'This week', events: 'Coming up',
};

/** Up/down. From the programme, down goes to the first channel. */
export function stepChannel(ch: Channel, dir: 1 | -1): Channel {
  const i = ch === 'programme' ? (dir === 1 ? -1 : 0) : CHANNELS.indexOf(ch);
  return CHANNELS[(i + dir + CHANNELS.length) % CHANNELS.length]!;
}

/*
 * There is deliberately no "photo" scene — a photograph with a caption in the
 * corner and nothing to say (the pastor, 2026-10-22: "we won't be using any sort of
 * slides just like that"). Photographs appear only BEHIND scenes that carry
 * something; the picture-led moments are the hero frames, which somebody made
 * on purpose.
 */
export type SceneKind =
  | 'welcome' | 'starting' | 'hero' | 'text' | 'singing' | 'announcement' | 'prayer' | 'celebrations'
  | 'signup' | 'events' | 'next-sunday' | 'services' | 'quiet' | 'thanks' | 'night'
  | 'give' | 'guest' | 'notice' | 'sermon';

/**
 * The two standing invitations, always in rotation whatever the bulletin says.
 * Each has its own small set of photographs, chosen for what it asks: the
 * children the church picks up and feeds behind Give ("our neighbors" on the
 * site's Give page), people talking in the foyer behind New Here.
 */
export const INVITE_PHOTOS: Record<'give' | 'guest', string[]> = {
  give: ['kids-pew', 'kids-seated', 'kids-singing', 'guitar', 'kids-pews', 'kids-raised'],
  guest: ['seniors-conversation', 'fellowship', 'talking', 'sent-men'],
};

/**
 * Where the faces are in each invitation photograph, as a fraction of its
 * height. These scenes show the photograph as a strip across the top of the
 * screen, above the invitation, so the strip is placed on the faces rather
 * than wherever the middle of the picture happens to be.
 */
export const PHOTO_FACES: Record<string, number> = {
  'kids-pew': .45, 'kids-seated': .5, 'kids-singing': .5, 'guitar': .48, 'kids-pews': .42, 'kids-raised': .5,
  'seniors-conversation': .27, 'fellowship': .44, 'talking': .4, 'sent-men': .44,
};
/** Long enough to read the line, find a phone and point it. */
export const INVITE_SECONDS = 16;

export interface Scene {
  kind: SceneKind;
  /** Stable across feed refreshes, so a refresh does not restart the cycle. */
  key: string;
  seconds: number;
  /** Indices into the source list: announcements, prayer requests, events,
   *  signups, heroes, or (celebrations) birthdays then anniversaries. */
  idx?: number[];
  /** Celebrations only: how many of `idx` are birthdays; the rest are
   *  anniversaries, indexed into that list. */
  split?: number;
  /** For a list scene, which page of how many. */
  page?: [number, number];
  /** A heading for scenes that need one ("This week", "Coming up"). */
  title?: string;
  /** A photograph to sit behind the scene: an index into screenPhotos(feed). */
  photo?: number;
}

export const PRAYER_PER_PAGE = 6;
/** Events sit on a shelf of three across: more would drop below the size floor. */
export const EVENTS_PER_PAGE = 3;
/**
 * Celebrations: seven rows to a column (what fits the safe area at 42 px), at
 * most three columns to a page. A month with more spills onto a second page
 * rather than shrinking anyone's name.
 */
export const CELEBRATION_ROWS = 7;
export const CELEBRATION_COLUMNS = 3;

export interface SceneContext {
  now: Date;
  clock: ClockParts;
  phase: PhaseAt;
  /** Advances once per lap so each lap shows different photographs. */
  lap: number;
}

const pages = <T,>(list: T[], per: number): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < list.length; i += per) out.push(list.slice(i, i + per).map((_, j) => i + j));
  return out;
};

/**
 * Celebrations, laid out in whole columns of CELEBRATION_ROWS: birthdays fill
 * columns first, anniversaries start a fresh column (they are a different
 * heading), and any page holds at most CELEBRATION_COLUMNS columns. Returns,
 * per page, the birthday indices and the anniversary indices on it.
 */
export function celebrationPages(birthdays: number, anniversaries: number): { b: number[]; a: number[] }[] {
  const cols: { kind: 'b' | 'a'; idx: number[] }[] = [];
  for (const [kind, n] of [['b', birthdays], ['a', anniversaries]] as const) {
    for (let i = 0; i < n; i += CELEBRATION_ROWS) {
      cols.push({ kind, idx: Array.from({ length: Math.min(CELEBRATION_ROWS, n - i) }, (_, j) => i + j) });
    }
  }
  const out: { b: number[]; a: number[] }[] = [];
  for (let i = 0; i < cols.length; i += CELEBRATION_COLUMNS) {
    const page = cols.slice(i, i + CELEBRATION_COLUMNS);
    out.push({
      b: page.filter((c) => c.kind === 'b').flatMap((c) => c.idx),
      a: page.filter((c) => c.kind === 'a').flatMap((c) => c.idx),
    });
  }
  return out;
}

/**
 * What to show, in order, for a phase or a channel.
 *
 * Scenes with nothing to say are left out rather than shown empty: no
 * bulletin means no "Today's text"; no events, no events scene. Whatever
 * happens, the list is never empty — the service times are always known.
 */
export function scenesFor(channel: Channel, feed: LobbyFeed, ctx: SceneContext): Scene[] {
  const b = feed.bulletin;
  const when = b ? bulletinWhen(b.serviceDate, ctx.clock.date) : 'stale';
  const current = b && when !== 'stale' ? b : null;
  // Indices into feed.events, so a scene can name its events directly; the
  // finished ones are dropped here and never reach a scene.
  const events = feed.events;
  const isUp = new Set(upcomingEvents(events, ctx.now, ctx.clock.date));
  const upcoming = events.map((_, i) => i).filter((i) => isUp.has(events[i]!));
  const weekEnd = addDays(ctx.clock.date, 7);
  const thisWeek = upcoming.filter((i) => {
    const e = events[i]!;
    return (e.allDay ? e.start.slice(0, 10) : clockParts(new Date(e.start)).date) < weekEnd;
  });
  // Further out: what the bulletin's "Coming Up" lists, so the dates people are
  // asked to keep in mind are on the wall as well as on paper.
  const later = upcoming.filter((i) => !thisWeek.includes(i)).slice(0, COMING_UP_MAX);
  const heroes = feed.heroes ?? [];
  const dueHeroes = heroes.map((_, i) => i).filter((i) => heroesFor([heroes[i]!], ctx.clock.date).length);

  // A new bulletin, a new arrangement; without one, a new one each week.
  const photos = screenPhotos(feed);
  const order = photoOrder(b?.serviceDate ?? addDays(ctx.clock.date, -ctx.clock.weekday), photos.length);
  let photoN = ctx.lap * 7;
  const photo = () => order[photoN++ % order.length]!;

  const ann = current?.announcements ?? [];
  const prayers = current?.prayerRequests ?? [];
  const s = {
    welcome: (): Scene => ({ kind: 'welcome', key: 'welcome', seconds: 14, photo: photo() }),
    heroes: (tag = ''): Scene[] => dueHeroes.map((i) =>
      ({ kind: 'hero', key: `hero-${heroes[i]!.id}${tag}`, seconds: HERO_SECONDS, idx: [i] })),
    text: (): Scene[] => current?.scripture || current?.scriptureRef
      ? [{ kind: 'text', key: 'text', seconds: dwellSeconds(current.scripture, current.scriptureRef, current.preacher), photo: photo() }] : [],
    singing: (): Scene[] => current?.singing?.slots.length
      ? [{ kind: 'singing', key: 'singing', photo: photo(),
           seconds: dwellSeconds(...current.singing.slots.flatMap((x) => [x.label, x.note, ...x.names])) }] : [],
    announcements: (): Scene[] => ann.map((a, i) =>
      ({ kind: 'announcement', key: `ann-${i}`, seconds: dwellSeconds(a.when, a.heading, a.detail), idx: [i], photo: photo() })),
    prayer: (): Scene[] => {
      const p = pages(prayers, PRAYER_PER_PAGE);
      return p.map((idx, i) => ({
        kind: 'prayer', key: `prayer-${i}`, seconds: dwellSeconds(...idx.map((j) => prayers[j])),
        idx, page: [i + 1, p.length], photo: photo(),
      }));
    },
    celebrations: (): Scene[] => {
      const c = current?.celebrations;
      if (!c) return [];
      const p = celebrationPages(c.birthdays.length, c.anniversaries.length);
      return p.map((pg, i) => ({
        kind: 'celebrations', key: `celebrations-${i}`, photo: photo(),
        idx: [...pg.b, ...pg.a], split: pg.b.length, page: [i + 1, p.length],
        seconds: dwellSeconds(...pg.b.map((j) => c.birthdays[j]!.name), ...pg.a.map((j) => c.anniversaries[j]!.name)),
      }));
    },
    signups: (): Scene[] => (current?.signups ?? []).map((x, i) =>
      ({ kind: 'signup', key: `signup-${i}`, seconds: Math.max(16, dwellSeconds(x.title, x.intro, x.when)), idx: [i], photo: photo() })),
    events: (list: number[], title: string, key: string): Scene[] => {
      const p = pages(list, EVENTS_PER_PAGE);
      return p.map((page, i) => ({
        kind: 'events', key: `${key}-${i}`, title, photo: photo(),
        seconds: dwellSeconds(...page.map((j) => `${events[list[j]!]!.title} ${events[list[j]!]!.when}`)),
        idx: page.map((j) => list[j]!), page: [i + 1, p.length],
      }));
    },
    nextSunday: (): Scene[] => when === 'upcoming' && current
      ? [{ kind: 'next-sunday', key: 'next-sunday', seconds: 14, photo: photo() }] : [],
    services: (): Scene => ({ kind: 'services', key: 'services', seconds: 14, photo: photo() }),
    sermon: (): Scene[] => sermonWhen(feed.sermon, ctx.clock.date)
      ? [{ kind: 'sermon', key: 'sermon', seconds: INVITE_SECONDS, photo: photo() }] : [],
    // The week's arrangement picks which of each set leads, and each lap moves on.
    invite: (kind: 'give' | 'guest'): Scene => {
      // Its own set (built-in, or uploads marked for it); if every one of them
      // is switched off, any photograph will do.
      const set = photos.map((p, i) => (p.uses.includes(kind) ? i : -1)).filter((i) => i >= 0)
        .sort((x, y) => order.indexOf(x) - order.indexOf(y));
      const pick = set.length ? set[ctx.lap % set.length]! : photo();
      return { kind, key: kind, seconds: INVITE_SECONDS, photo: pick };
    },
  };

  /*
   * Hero frames come early — straight after the welcome — and, in a long
   * cycle, once more halfway through, so a poster is never more than a few
   * minutes away for someone who has just walked in.
   */
  const withHeroes = (head: Scene[], body: Scene[]): Scene[] => {
    const first = s.heroes();
    if (!first.length || body.length < 8) return [...head, ...first, ...body];
    const mid = Math.ceil(body.length / 2);
    return [...head, ...first, ...body.slice(0, mid), ...s.heroes('-again'), ...body.slice(mid)];
  };

  // The notice put up on the Lobby tab: straight after the opening scene, every lap.
  const notice: Scene[] = noticeLive(feed.settings?.notice ?? null, ctx.now)
    ? [{ kind: 'notice', key: 'notice', photo: photo(),
         seconds: Math.max(12, dwellSeconds(feed.settings!.notice!.title, feed.settings!.notice!.detail)) }]
    : [];

  let list: Scene[];
  if (channel === 'programme') {
    switch (ctx.phase.phase) {
      case 'before':
        // The last few minutes hold still: the room needs to move, not read.
        if ((ctx.phase.minutesToStart ?? Infinity) <= STARTING_MIN) {
          list = [{ kind: 'starting', key: 'starting', seconds: 60, photo: photo() }];
          break;
        }
        // New Here early, while visitors are arriving; Give at the end.
        list = withHeroes([s.welcome(), ...notice], [s.invite('guest'), ...s.text(), ...s.singing(), ...s.announcements(),
          ...s.events(later, 'Coming up', 'later'), ...s.prayer(), ...s.celebrations(), ...s.signups(), ...s.sermon(),
          s.invite('give')]);
        break;
      case 'during':
        // One still scene, no motion near the doors.
        list = [{ kind: 'quiet', key: 'quiet', seconds: 60, photo: photo() }];
        break;
      case 'after':
        list = withHeroes([{ kind: 'thanks', key: 'thanks', seconds: 12, photo: photo() }, ...notice],
          [s.invite('guest'), ...s.announcements(), ...s.events(thisWeek, 'This week', 'week'),
            ...s.events(later, 'Coming up', 'later'), ...s.signups(), ...s.sermon(), s.invite('give')]);
        break;
      case 'night':
        list = [{ kind: 'night', key: 'night', seconds: 60 }];
        break;
      default:
        list = withHeroes([...notice], [s.services(), ...s.events(thisWeek, 'This week', 'week'), ...s.nextSunday(),
          ...s.sermon(), ...s.announcements(), ...s.events(later, 'Coming up', 'later'), s.invite('give'), ...s.prayer(),
          ...s.celebrations(), ...s.signups(), s.invite('guest')]);
    }
  } else if (channel === 'today') {
    list = [s.welcome(), ...notice, ...s.heroes(), s.invite('guest'), ...s.text(), ...s.singing(), ...s.announcements(),
      ...s.prayer(), ...s.celebrations(), ...s.signups(), ...s.sermon(), s.invite('give')];
  } else if (channel === 'week') {
    list = [s.services(), ...s.events(thisWeek, 'This week', 'week'), ...s.nextSunday()];
  } else {
    list = [...s.events(upcoming, 'Coming up', 'events'), ...s.heroes(), ...s.signups()];
  }
  /*
   * The Lobby tab's settings, last: switched-off scene types drop out (the
   * welcome, the hold, the quiet scene and the night clock cannot be switched
   * off), and every scene's time is scaled by the pace — a multiplier, so a
   * long list still outlasts a short one and a hero frame still holds longest.
   */
  const hidden = new Set(feed.settings?.hidden ?? []);
  const pace = feed.settings?.pace ?? 1;
  list = list.filter((x) => !hidden.has(x.kind));
  if (!list.length) list = [s.services()];
  return pace === 1 ? list : list.map((x) => ({ ...x, seconds: Math.round(x.seconds * pace) }));
}

/* ==== housekeeping ======================================================== */

/**
 * How often the page asks whether anything has changed. Cheap: the answer is
 * usually "no" from one small query (lib/lobby-stamp-db.ts).
 */
export const POLL_MS = 2 * 60_000;
/** How often it takes the whole feed regardless, for what the stamp cannot see (the website's events and sermon). */
export const FULL_REFRESH_MS = 60 * 60_000;

/** A short, URL-safe fingerprint (FNV-1a), so the screen sends back 7 characters rather than the raw dates. */
export function stampOf(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** A minute of nobody touching the remote returns the screen to its programme. */
export const IDLE_MS = 60_000;

/**
 * Whether to reload the page to pick up a deploy: once, in the small hours,
 * and only if it has been up long enough that this is not the reload itself.
 */
export function shouldReload(c: ClockParts, uptimeMs: number): boolean {
  return c.minutes >= 3 * 60 && c.minutes < 3 * 60 + 10 && uptimeMs > 2 * 3600_000;
}
