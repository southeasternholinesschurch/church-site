#!/usr/bin/env node
/**
 * Pulls the spoken text of each sermon out of YouTube, so the sermon pages can
 * carry something a search engine can read.
 *
 *   node scripts/import-transcripts.mjs --dry-run
 *   node scripts/import-transcripts.mjs --write
 *   node scripts/import-transcripts.mjs --write --only 2026-09-06-sunday-morning
 *
 * WHY OAUTH AND NOT THE API KEY
 * -----------------------------
 * Captions are the one part of a video the public API will not hand out for a
 * key. captions.list and captions.download both require OAuth as the CHANNEL
 * OWNER, which is fine — this is the church's own channel and its own words.
 *
 * Every unofficial route was tried first, on 2026-09-11, and all three are now
 * closed:
 *   - the legacy /api/timedtext endpoint returns 200 with an empty body
 *   - the captionTracks baseUrl lifted from the watch page returns 0 bytes
 *   - yt-dlp reports "automatic captions missing because a PO token was not
 *     provided"
 * So this is not the awkward option, it is the only remaining one.
 *
 * A KNOWN LIMITATION, STATED UP FRONT
 * -----------------------------------
 * captions.download on an AUTO-GENERATED (ASR) track is refused with 403 on
 * some channels — YouTube ties it to whether third-party contributions were
 * ever enabled. It is not knowable without trying. When it happens this script
 * says so per video, with the fix, rather than failing silently or pretending
 * the sermon has no captions.
 *
 * WHAT IT WRITES
 * --------------
 * Plain text to site/transcripts/<slug>.txt — deliberately NOT a content
 * collection, because a raw ASR transcript is unpunctuated and close to
 * unreadable. It is raw material for the article that goes in the sermon body,
 * not something to publish as it stands.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERMONS = path.join(HERE, '..', 'src', 'content', 'sermons');
const OUT = path.join(HERE, '..', 'transcripts');

const argv = process.argv.slice(2);
const args = new Set(argv);
const DRY = args.has('--dry-run') || !args.has('--write');
const FORCE = args.has('--force');
/**
 * indexOf returns -1 when a flag is absent, and argv[-1 + 1] is argv[0] — so
 * `--write` alone was read as `--only --write`, matched no sermon, and the run
 * reported "wrote 0" while doing exactly nothing. Read flags explicitly.
 */
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const ONLY = flagValue('--only');

/**
 * QUOTA is the binding constraint, not time.
 *
 * The YouTube Data API allows 10,000 units a day. captions.list costs 50 and
 * captions.download costs 200, so each sermon is 250 — which caps a run at 40
 * sermons a day, and a 60-sermon back-catalogue at two days. Exceeding it does
 * not queue, it returns 403 quotaExceeded for everything else that day,
 * including the sermon importer that shares this project.
 *
 * So the default leaves room for the nightly sermon import rather than
 * spending the entire allowance. Pass --limit to override deliberately.
 */
const UNITS_LIST = 50, UNITS_DOWNLOAD = 200, DAILY_QUOTA = 10_000;
const DEFAULT_LIMIT = 35;
const LIMIT = Number(flagValue('--limit')) || DEFAULT_LIMIT;

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
  console.error('Missing OAuth credentials. This needs three secrets:');
  console.error('  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN');
  console.error('See docs/transcripts.md for how to obtain them once.');
  process.exit(1);
}

/** Refresh tokens do not expire on their own; access tokens last an hour. */
async function accessToken() {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`token refresh failed ${res.status}: ${body.error_description ?? body.error}`);
  return body.access_token;
}

async function api(url, token) {
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  return { ok: res.ok, status: res.status, res };
}

/** Prefer a human-corrected track; fall back to the auto-generated one. */
function pickTrack(items) {
  const english = items.filter((t) => (t.snippet?.language ?? '').startsWith('en'));
  return english.find((t) => t.snippet?.trackKind !== 'ASR') ?? english[0] ?? null;
}

/** SRT to prose. Timings and indices carry nothing a reader or a crawler wants. */
function srtToText(srt) {
  const lines = srt.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^\d+$/.test(line.trim())) continue;                       // cue index
    if (/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/.test(line.trim())) continue; // timing
    out.push(line.trim());
  }
  // ASR repeats the previous line as it rolls; collapse consecutive duplicates.
  const deduped = out.filter((l, i) => l !== out[i - 1]);
  return deduped.join(' ').replace(/\s+/g, ' ').trim();
}

function sermonsOnDisk() {
  return fs.readdirSync(SERMONS).filter((f) => f.endsWith('.md')).map((f) => {
    const slug = f.replace(/\.md$/, '');
    const src = fs.readFileSync(path.join(SERMONS, f), 'utf8');
    const id = /^youtubeId:\s*"?([A-Za-z0-9_-]{6,})"?/m.exec(src)?.[1];
    return { slug, youtubeId: id };
  }).filter((s) => s.youtubeId);
}

// ------------------------------------------------------------------- main --
const token = await accessToken();
let targets = sermonsOnDisk();
if (ONLY) targets = targets.filter((t) => t.slug === ONLY);
fs.mkdirSync(OUT, { recursive: true });

let written = 0, skipped = 0, refused = 0, none = 0, units = 0;
const refusals = [];

for (const t of targets) {
  const dest = path.join(OUT, `${t.slug}.txt`);
  if (fs.existsSync(dest) && !FORCE) { skipped++; continue; }
  if (written + refused + none >= LIMIT) {
    console.log(`\n  stopping at --limit ${LIMIT}; the rest will be picked up on the next run.`);
    break;
  }

  units += UNITS_LIST;
  const list = await api(
    `https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${t.youtubeId}`, token);
  if (list.status === 403 && /quota/i.test(await list.res.clone().text())) {
    console.error('\n  QUOTA EXHAUSTED for today. Re-run tomorrow; already-fetched transcripts are kept.');
    break;
  }
  if (!list.ok) {
    console.error(`  ${t.slug}: captions.list -> ${list.status}`);
    refused++; continue;
  }
  const track = pickTrack((await list.res.json()).items ?? []);
  if (!track) { console.log(`  ${t.slug}: no English captions on the video`); none++; continue; }

  units += UNITS_DOWNLOAD;
  const dl = await api(
    `https://www.googleapis.com/youtube/v3/captions/${track.id}?tfmt=srt`, token);
  if (!dl.ok) {
    const why = dl.status === 403
      ? '403 — YouTube refuses API download of this auto-generated track'
      : `${dl.status}`;
    refusals.push({ slug: t.slug, kind: track.snippet?.trackKind ?? '?', why });
    refused++; continue;
  }

  const text = srtToText(await dl.res.text());
  if (text.length < 200) { console.log(`  ${t.slug}: track was empty`); none++; continue; }
  if (!DRY) fs.writeFileSync(dest, text + '\n');
  console.log(`  ${t.slug}: ${text.split(' ').length} words (${track.snippet?.trackKind ?? 'manual'})`);
  written++;
}

console.log(`\n${DRY ? 'DRY RUN — would write' : 'Wrote'} ${written}, skipped ${skipped} already present, ${none} with no captions, ${refused} refused.`);
console.log(`Used about ${units} of the ${DAILY_QUOTA} daily API units (${Math.round(100 * units / DAILY_QUOTA)}%).`);

if (refusals.length) {
  console.log('\nRefused by YouTube:');
  for (const r of refusals) console.log(`  ${r.slug}  [${r.kind}]  ${r.why}`);
  console.log('\nIf these are ASR tracks, the API will not release them for this channel.');
  console.log('Opening the video in YouTube Studio, editing the auto-captions and');
  console.log('publishing them converts the track to a real one, which the API will');
  console.log('then hand over. That is per video, so it is worth checking whether it');
  console.log('is refusing ALL of them before doing it by hand 60 times.');
}
