#!/usr/bin/env node
/**
 * One-off import of the YouTube back-catalogue into src/content/sermons/.
 *
 *   node scripts/import-sermons.mjs --dry-run              # RSS, last ~15, no key
 *   YOUTUBE_API_KEY=… node scripts/import-sermons.mjs --dry-run
 *   YOUTUBE_API_KEY=… node scripts/import-sermons.mjs --write --limit 20
 *   YOUTUBE_API_KEY=… node scripts/import-sermons.mjs --write --prune
 *
 * Flags: --months N (default 6, matches the site's rolling window)
 *        --limit N  (keep only the N most recent services)
 *        --prune    (delete files that have aged out of the window)
 *        --force    (overwrite entries that already exist)
 *        --strict   (exit non-zero if titles stop parsing — used by CI)
 *
 * WHY THIS IS NOT A THIN WRAPPER OVER THE API
 * -------------------------------------------
 * Three things about this channel make the obvious import wrong:
 *
 * 1. The upload date is NOT the service date. Uploads lag by 1–8 days in the
 *    real data. Importing on `publishedAt` misdates every entry, sometimes
 *    into the wrong week. The date is parsed out of the title instead, and any
 *    title that doesn't carry one is SKIPPED and reported — never guessed.
 *
 * 2. Restarted livestreams leave several uploads for one service. In a
 *    six-week sample, 2 of 13 services had duplicates and one had three. They
 *    are collapsed by (service date + service type), keeping the longest
 *    recording of a plausible length — see the collapse block for why "longest"
 *    alone is wrong. Every collapse is reported so it can be spot-checked.
 *
 * 3. There is no sermon title, speaker, scripture or series in the channel
 *    metadata at all — descriptions are boilerplate Restream text. The script
 *    therefore writes none of those, rather than inventing them.
 *
 * Re-running is safe: filenames are derived from date + service type, so an
 * existing file is left alone unless --force is passed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(HERE, '..', 'src', 'content', 'sermons');
const CHANNEL_ID = 'UCCjlcMeiioBKihboxwgvnEg';

const argv = process.argv.slice(2);
const args = new Set(argv);
const flagValue = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : fallback;
};
const DRY = args.has('--dry-run') || !args.has('--write');
const FORCE = args.has('--force');
const PRUNE = args.has('--prune');
/**
 * CI safety net. Unattended, a silent parse failure is the dangerous case: if
 * the channel's titling changes, every upload stops matching and the job would
 * happily commit nothing while the archive quietly goes stale. --strict turns
 * that into a failed build instead.
 */
const STRICT = args.has('--strict');
/**
 * The site carries a rolling window, not the whole catalogue — see
 * SERMON_WINDOW_MONTHS in src/lib/content.ts. Importing four years of services
 * would create hundreds of pages that age out of the site immediately, so the
 * import is bounded the same way. `--limit` caps it further for a first run.
 */
const WINDOW_MONTHS = flagValue('--months', 6);
const LIMIT = flagValue('--limit', Infinity);
const KEY = process.env.YOUTUBE_API_KEY;

// ---------------------------------------------------------------- parsing --
// Kept in step with src/lib/sermons.ts. Duplicated deliberately: this script
// is plain node run by hand, and must not depend on the TypeScript toolchain.
const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
/**
 * The channel's dates are hand-typed and drift: "August 23, 2026" is the norm,
 * but "July 8th, 2026" (ordinal), "August, 25, 2024" (comma after the month)
 * and "May 26. 2024" (period for the comma) all occur. The separators are
 * therefore character classes and the ordinal suffix is optional — four
 * services inside the live window were being skipped for a "th".
 *
 * Still deliberately anchored to the START of the title. Titles that bury the
 * date in the middle ("Sunday Morning Worship February 18, 2024") are left to
 * the skip report: matching mid-string would drag the sermon title and speaker
 * into the service label, and every such upload predates the naming scheme.
 */
const DATE_CORE = String.raw`([A-Za-z]+)[\s,]+(\d{1,2})(?:st|nd|rd|th)?[\s,.]+(\d{4})`;
const TITLE_RE = new RegExp(String.raw`^\s*${DATE_CORE},?\s*(.*)$`, 'i');
const DATE_ONLY_RE = new RegExp(String.raw`^\s*${DATE_CORE}\s*$`, 'i');

function classifyService(service) {
  const s = service.toLowerCase();
  if (s.includes('wednesday')) return 'wednesday';
  if (s.includes('sunday')) {
    // "PM" is used as often as the word "evening" — "Sunday Service PM",
    // "Sunday PM Spring Revival". Word-bounded so it can't fire inside a word.
    if (s.includes('evening') || s.includes('night') || /\bpm\b/.test(s)) return 'sunday-evening';
    return 'sunday-morning';
  }
  return 'other';
}

function parseDatePart(part) {
  const m = DATE_ONLY_RE.exec(part);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return null;
  const day = Number(m[2]), year = Number(m[3]);
  if (day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

/** A dash in a slot means "deliberately left empty". */
function optional(part) {
  const v = (part ?? '').trim();
  return !v || v === '-' || v === '\u2014' || v === '\u2013' ? undefined : v;
}

/**
 * Both title formats:
 *   "August 23, 2026 | Sunday Morning Worship | Pastor the pastor | The Narrow Gate"
 *   "August 23, 2026 Sunday Morning Worship"   (legacy — existing uploads)
 */
function parseServiceTitle(title) {
  if (title.includes('|')) {
    const parts = title.split('|').map((p) => p.trim());
    const date = parseDatePart(parts[0] ?? '');
    if (!date) return null;
    const service = optional(parts[1]) ?? 'Service';
    return { date, service, serviceType: classifyService(service),
             speaker: optional(parts[2]), sermonTitle: optional(parts[3]) };
  }
  const m = TITLE_RE.exec(title);
  if (!m) return null;
  const date = parseDatePart(`${m[1]} ${m[2]}, ${m[3]}`);
  if (!date) return null;
  const service = m[4].trim() || 'Service';
  return { date, service, serviceType: classifyService(service) };
}

function isoDurationToSeconds(iso) {
  const m = /^P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/.exec(iso || '');
  if (!m) return 0;
  return (+m[1]||0)*86400 + (+m[2]||0)*3600 + (+m[3]||0)*60 + (+m[4]||0);
}

// ---------------------------------------------------------------- sources --
/** No key needed, but only the ~15 most recent uploads. Enough to rehearse. */
async function fetchViaRss() {
  // The cache-buster is load-bearing. YouTube serves this feed through a CDN
  // with `cache-control: public, max-age=900`, so a plain fetch can return a
  // copy up to 15 minutes old — long enough that renaming a video and running
  // the import straight afterwards silently imports the OLD title. `cache:
  // 'no-store'` does not help: that is a client directive, and the CDN still
  // hands back its cached object. Only a unique query string misses the cache.
  const url = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}&_=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`RSS feed returned ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const e = m[1];
    const g = (re) => (e.match(re) || [])[1] || '';
    return {
      videoId: g(/<yt:videoId>(.*?)<\/yt:videoId>/),
      title: g(/<title>(.*?)<\/title>/),
      publishedAt: g(/<published>(.*?)<\/published>/),
      durationSec: null, // not in the RSS feed
    };
  });
}

/**
 * Thrown for a spent daily quota, which is NOT the same kind of problem as a
 * broken API call. --strict exists to fail loudly when the channel's titling
 * changes and the archive would silently go stale — a real, human problem. A
 * spent quota is "come back tomorrow", and the nightly job does. Treating them
 * the same puts a red cross on the repository every night for a transient
 * condition, which is how people learn to ignore failing builds.
 */
class QuotaExceeded extends Error {}

async function api(endpoint, params) {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
  for (const [k, v] of Object.entries({ ...params, key: KEY })) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 403 && /quotaExceeded/i.test(body)) {
      throw new QuotaExceeded(`YouTube API quota is spent for today (${endpoint}).`);
    }
    throw new Error(`YouTube API ${endpoint} -> ${res.status}. ${body.slice(0, 300)}`);
  }
  return res.json();
}

/** Full catalogue. Paginates the uploads playlist, then batches for durations. */
async function fetchViaApi() {
  const ch = await api('channels', { part: 'contentDetails', id: CHANNEL_ID });
  const uploads = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error('Could not resolve the uploads playlist for that channel id');

  const items = [];
  let pageToken;
  do {
    const page = await api('playlistItems', {
      part: 'snippet,contentDetails', playlistId: uploads, maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    for (const it of page.items ?? []) {
      items.push({
        videoId: it.contentDetails?.videoId,
        title: it.snippet?.title ?? '',
        publishedAt: it.contentDetails?.videoPublishedAt ?? it.snippet?.publishedAt ?? '',
        durationSec: null,
      });
    }
    pageToken = page.nextPageToken;
    process.stderr.write(`\r  fetched ${items.length} uploads…`);
  } while (pageToken);
  process.stderr.write('\n');

  // Durations come from a separate endpoint, 50 ids at a time. They are what
  // makes duplicate collapsing trustworthy, so this is not optional.
  for (let i = 0; i < items.length; i += 50) {
    const batch = items.slice(i, i + 50);
    const res = await api('videos', { part: 'contentDetails', id: batch.map((b) => b.videoId).join(',') });
    const byId = new Map((res.items ?? []).map((v) => [v.id, isoDurationToSeconds(v.contentDetails?.duration)]));
    for (const b of batch) b.durationSec = byId.get(b.videoId) ?? 0;
    process.stderr.write(`\r  durations ${Math.min(i + 50, items.length)}/${items.length}…`);
  }
  process.stderr.write('\n');
  return items;
}

// ------------------------------------------------------------------- main --
const fmtDur = (s) => (s == null ? 'unknown' : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`);

/**
 * Unattended, a keyless run is worse than no run at all.
 *
 * Without durations the collapse degrades to "first seen wins", and the RSS
 * feed is ordered newest-first — so for a restarted stream it picks the LAST
 * upload, which is usually the short tail. The importer refreshes pristine
 * files, so that wrong pick would be written straight over a correct one: a
 * keyless nightly run can silently undo the API's work. (This is not
 * hypothetical — 2026-08-23 was a 74m fragment chosen exactly this way, over
 * the 143m complete recording.)
 *
 * --strict already means "fail loudly rather than degrade quietly", so it
 * covers this too. A keyless run by hand is still fine for a rehearsal.
 */
if (STRICT && !KEY) {
  console.error('STRICT: no YOUTUBE_API_KEY set.');
  console.error('Without durations, duplicate uploads are resolved by feed order, which');
  console.error('would overwrite correct entries with short stream fragments. Refusing.');
  console.error('Set the YOUTUBE_API_KEY secret, or drop --strict to rehearse from RSS.');
  process.exit(1);
}

let raw;
try {
  raw = KEY ? await fetchViaApi() : await fetchViaRss();
} catch (err) {
  if (err instanceof QuotaExceeded) {
    console.log(`${err.message}`);
    console.log('Nothing imported. The quota resets at midnight Pacific and the');
    console.log('nightly run will catch up — this is not a failure to act on.');
    process.exit(0);
  }
  throw err;
}
if (!KEY) {
  console.log('No YOUTUBE_API_KEY set — using the public RSS feed (most recent uploads only).');
  console.log('This is a rehearsal, not the real import. Durations are unavailable, so');
  console.log('duplicates fall back to "first seen wins".\n');
}
console.log(`Source returned ${raw.length} uploads.\n`);

const skipped = [];
const parsed = [];
for (const v of raw) {
  const p = parseServiceTitle(v.title);
  if (!p) { skipped.push(v); continue; }
  parsed.push({ ...v, ...p, slug: `${p.date}-${p.serviceType}` });
}

/**
 * Collapse duplicates. "Longest wins" is right for the common case — a
 * restarted stream leaves short fragments plus the one complete recording —
 * but it breaks at both ends, and the real data contains both failures:
 *
 *   2026-06-28  387m, 173m, 0m   ← a stream left running for hours after the
 *                                  service; the 173m file IS the service
 *   2024-11-17  379m, 0m15s      ← runaway stream, and the only alternative
 *                                  is a 15-second stub
 *
 * So: prefer the longest recording of a PLAUSIBLE length, and fall back to the
 * longest overall when nothing is plausible. That takes 173m in the first case
 * and still takes 379m in the second, where the runaway file is at least
 * complete. The band is deliberately wide — a short Wednesday runs ~25 minutes
 * and a revival night ~3 hours — because its only job is to exclude stubs and
 * streams nobody stopped, not to judge a service.
 */
const PLAUSIBLE_MIN_SEC = 20 * 60;
const PLAUSIBLE_MAX_SEC = 240 * 60;
const plausible = (v) => {
  const d = v.durationSec ?? 0;
  return d >= PLAUSIBLE_MIN_SEC && d <= PLAUSIBLE_MAX_SEC;
};
/** Ranked, not compared ad hoc, so the fold is order-independent. */
const beats = (a, b) => {
  const pa = plausible(a), pb = plausible(b);
  if (pa !== pb) return pa;                       // a plausible length wins outright
  return (a.durationSec ?? -1) > (b.durationSec ?? -1);
};

const bySlug = new Map();
for (const v of parsed) {
  const prev = bySlug.get(v.slug);
  if (!prev) { bySlug.set(v.slug, v); continue; }
  const better = beats(v, prev) ? v : prev;
  const loser = better === v ? prev : v;
  better.collapsed = [...(prev.collapsed ?? []), ...(v.collapsed ?? []), loser];
  bySlug.set(v.slug, better);
}
let records = [...bySlug.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

const collapsed = records.filter((r) => r.collapsed?.length);
if (collapsed.length) {
  console.log(`Collapsed ${collapsed.length} service(s) with multiple uploads — CHECK THESE:`);
  for (const r of collapsed) {
    console.log(`  ${r.date} ${r.service}`);
    console.log(`    KEEP  ${r.videoId}  ${fmtDur(r.durationSec)}`);
    for (const c of r.collapsed) console.log(`    drop  ${c.videoId}  ${fmtDur(c.durationSec)}`);
  }
  console.log();
}
if (skipped.length) {
  console.log(`Skipped ${skipped.length} upload(s) with no parseable service date — import by hand if wanted:`);
  for (const v of skipped) console.log(`  ${v.videoId}  ${JSON.stringify(v.title)}`);
  console.log();
}

// Bound to the same rolling window the site renders, then to --limit.
const cutoff = new Date();
cutoff.setUTCMonth(cutoff.getUTCMonth() - WINDOW_MONTHS);
const cutoffStr = cutoff.toISOString().slice(0, 10);
const aged = records.filter((r) => r.date < cutoffStr);
records = records.filter((r) => r.date >= cutoffStr);
if (aged.length) console.log(`Outside the ${WINDOW_MONTHS}-month window, skipped: ${aged.length} service(s) older than ${cutoffStr}.\n`);
if (records.length > LIMIT) {
  console.log(`--limit ${LIMIT}: keeping the ${LIMIT} most recent of ${records.length}.\n`);
  records = records.slice(0, LIMIT);
}

const byType = records.reduce((a, r) => ((a[r.serviceType] = (a[r.serviceType] ?? 0) + 1), a), {});
console.log(`${records.length} services to write:`, byType);
if (records.length) console.log(`Range: ${records[records.length - 1].date} → ${records[0].date}\n`);

const yaml = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
/**
 * Is this file still exactly as the importer left it?
 *
 * Skipping every existing file — the obvious behaviour — means the site can
 * never follow a correction made on YouTube. The case that will actually bite:
 * duplicate uploads. Without the API there are no durations, so the collapse
 * picks the newest of a restarted stream more or less arbitrarily. When
 * someone notices a partial recording and deletes the bad upload, the file
 * already exists, the import skips it, and the site keeps pointing at a video
 * that is now gone. The same applies to fixing a typo'd date or a wrong
 * service label in a title.
 *
 * But blindly overwriting would destroy anything typed into the CMS. So:
 * update a file only while it is untouched — no body text, and no fields
 * beyond the ones this script writes. The moment a human edits it, it becomes
 * theirs and is left alone (differences are reported instead).
 */
const IMPORTER_KEYS = new Set(['date', 'service', 'serviceType', 'youtubeId', 'title', 'speaker', 'draft']);
function isPristine(raw) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
  if (!m) return false;
  if (m[2].trim() !== '') return false; // someone wrote notes in the body
  return m[1]
    .split('\n')
    .filter((l) => l.trim())
    .every((l) => IMPORTER_KEYS.has(l.slice(0, l.indexOf(':')).trim()));
}

/*
 * Which video each existing entry is of, so the same service cannot be filed
 * twice under two names.
 *
 * The slug is date + service type, but the SERVICE TYPE comes from the YouTube
 * title, and titles get edited after the fact. A stream that goes up as
 * "Evening Worship" is imported as <date>-other; retitled to "Sunday School
 * and Evening Worship", the next night's run files it again as
 * <date>-sunday-evening. Two pages, one service, the same transcript on both.
 *
 * The video id is the identity; the slug is only a filename.
 */
function videoIdOf(file) {
  const m = /^youtubeId:\s*["']?([^"'\s]+)/m.exec(fs.readFileSync(path.join(OUT_DIR, file), 'utf8'));
  return m ? m[1] : null;
}
const existingByVideo = new Map();
if (fs.existsSync(OUT_DIR)) {
  for (const f of fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.md'))) {
    const id = videoIdOf(f);
    if (id) existingByVideo.set(id, f.replace(/\.md$/, ''));
  }
}

let written = 0, updated = 0, kept = 0;
const handEdited = [];
const refiled = [];
for (const r of records) {
  const file = path.join(OUT_DIR, `${r.slug}.md`);
  const body = [
    '---',
    `date: ${r.date}`,
    `service: ${yaml(r.service)}`,
    `serviceType: ${r.serviceType}`,
    `youtubeId: ${yaml(r.videoId)}`,
    ...(r.sermonTitle ? [`title: ${yaml(r.sermonTitle)}`] : []),
    ...(r.speaker ? [`speaker: ${yaml(r.speaker)}`] : []),
    'draft: false',
    '---',
    '',
  ].join('\n');

  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    if (existing === body) { kept++; continue; }          // already correct
    if (!FORCE && !isPristine(existing)) {                 // hand-edited: hands off
      handEdited.push(r.slug);
      kept++;
      continue;
    }
    if (!DRY) fs.writeFileSync(file, body);
    updated++;
    continue;
  }

  /*
   * This slug is new, but is the VIDEO? If the service was already imported
   * under a different name, writing this would publish it a second time.
   *
   * Reported, not resolved. Renaming the existing entry to match is the
   * tempting fix and it is the wrong one: sermon URLs are permanent and
   * indexed, and a rename turns every link to the old one into a 404 —
   * including whatever the transcript on it has earned in search. Which of the
   * two names is right is a judgement call, so it goes to a person.
   */
  const already = existingByVideo.get(r.videoId);
  if (already && already !== r.slug) {
    refiled.push({ slug: r.slug, already, service: r.service });
    kept++;
    continue;
  }

  if (!DRY) { fs.mkdirSync(OUT_DIR, { recursive: true }); fs.writeFileSync(file, body); }
  existingByVideo.set(r.videoId, r.slug);
  written++;
}

if (refiled.length) {
  console.log(`\nSkipped ${refiled.length} service(s) already imported under another name:`);
  for (const x of refiled) {
    console.log(`  ${x.slug}  is the same video as  ${x.already}   ("${x.service}")`);
  }
  console.log('  The YouTube title changed after the first import. Delete whichever entry is wrong');
  console.log('  in the dashboard (Website → Sermons → Remove); nothing was written for these.\n');
}

if (handEdited.length) {
  console.log(`Left ${handEdited.length} hand-edited entr(ies) alone even though the YouTube title now differs:`);
  for (const slug of handEdited) console.log(`  ${slug}  (edit it in the CMS, or --force to overwrite)`);
  console.log();
}

if (STRICT && raw.length) {
  const ratio = skipped.length / raw.length;
  if (parsed.length === 0) {
    console.error(`\nSTRICT: ${raw.length} uploads and NONE parsed. The channel's titling has probably changed — see the convention in src/lib/sermons.ts.`);
    process.exit(1);
  }
  if (ratio > 0.5) {
    console.error(`\nSTRICT: ${skipped.length}/${raw.length} uploads failed to parse (${Math.round(ratio*100)}%). Refusing to import a partial set.`);
    process.exit(1);
  }
}

console.log(DRY
  ? `DRY RUN — would add ${written}, update ${updated}, leave ${kept} unchanged.`
  : `Added ${written}, updated ${updated}, left ${kept} unchanged.`);

// Ageing out of the window already hides a service from the site, so pruning
// is housekeeping, not correctness. Opt-in for that reason.
if (PRUNE) {
  const stale = fs.existsSync(OUT_DIR)
    ? fs.readdirSync(OUT_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}-/.test(f) && f.slice(0, 10) < cutoffStr)
    : [];
  for (const f of stale) if (!DRY) fs.unlinkSync(path.join(OUT_DIR, f));
  console.log(`${DRY ? 'Would prune' : 'Pruned'} ${stale.length} file(s) older than ${cutoffStr}.`);
} else {
  console.log(`(Files older than ${cutoffStr} are hidden by the site's rolling window but kept on disk. --prune removes them.)`);
}
if (DRY) console.log('Re-run with --write to actually create them.');
