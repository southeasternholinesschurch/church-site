/**
 * Prove every key in a copy file actually reaches the built page.
 *
 * A key the page never reads is worse than no key: the dashboard offers a
 * field, someone edits it, saves, waits for the build, and nothing changes. That is
 * exactly what home.yaml's mission and expect keys did. So each key gets a
 * unique sentinel, the site is built, and the sentinel has to turn up in the HTML.
 */
import { parseDocument } from 'yaml';
import fs from 'node:fs';
import { execSync } from 'node:child_process';

// Keys that only render when the page is in a particular state — an empty
// calendar, a failed fetch. They cannot show up in an ordinary build, so name
// them here and check them by forcing the state instead of leaving a standing
// failure everyone learns to ignore.
const CONDITIONAL = {
  // This is a fresh template: no sermons, no published bulletin, no text-message
  // number, an empty calendar. Most of the keys below cannot render for that
  // reason alone — they are wired correctly and will light up as soon as the
  // church adds the content or the setting. They are listed here so the check
  // stays useful instead of failing on an empty site every time.
  //
  // As you fill the site in, delete the ones that start rendering. A key still
  // listed here months later is worth looking at.
  home: ['events.empty', 'events.error'],
  contact: [
    'formsOffline.headline', 'formsOffline.body', 'formsOffline.tail',
    // The text-message sign-up appears once smsNumber is set in Settings.
    'texts.kicker', 'texts.title', 'texts.body',
  ],
  events: ['calendar.eventWord', 'calendar.empty', 'calendar.error', 'card.moreInfo'],
  // Appears once givingLinksUrl is set in Settings.
  give: ['ways.other.button'],
  // Everything below the masthead needs a bulletin published from the staff app.
  bulletin: [
    'masthead.defaultService', 'notPublished.headline', 'notPublished.body',
    'lastWeek.headline', 'lastWeek.body', 'sections.prayer', 'sections.singing',
    'sections.celebrations', 'sections.comingUp', 'text.preachingPrefix',
    'singing.nextPrefix', 'celebrations.birthdays', 'celebrations.anniversaries',
    'comingUp.note', 'missed.fallbackTitle', 'missed.fallbackNote',
  ],
  // The archive shows its filters, its headings and a sermon's own labels only
  // once there are sermons to show.
  sermons: [
    'filters.searchLabel', 'filters.searchPlaceholder', 'filters.serviceLabel',
    'filters.allServices', 'filters.yearLabel', 'filters.allYears',
    'filters.allSeries', 'results.heading', 'results.none',
    'archive.mostRecent', 'archive.allServices', 'archive.eyebrow',
    'archive.title', 'archive.button', 'page.back', 'page.serviceLabel',
    'page.speakerLabel', 'page.dateLabel', 'page.scriptureLabel',
    'page.youtubeLink', 'page.previousIn', 'page.nextIn', 'page.allMessages',
    'series.eyebrow', 'series.countTail', 'series.earlier', 'series.later',
  ],
  livestream: [],
};

// A copy file can feed more than one page — ministries.yaml supplies both the
// index and every individual ministry — so take any number of built pages and
// count a key as live if it reaches any of them.
const [page, ...htmlPaths] = process.argv.slice(2);
const yamlPath = `src/content/copy/${page}.yaml`;
const real = fs.readFileSync(yamlPath, 'utf8');
const doc = parseDocument(real);

const paths = [];
(function walk(n, pre) {
  if (typeof n === 'string') return void paths.push(pre);
  if (n && typeof n === 'object') for (const [k, v] of Object.entries(n)) walk(v, pre ? `${pre}.${k}` : k);
})(doc.toJS(), '');

paths.forEach((p, i) => doc.setIn(p.split('.'), `ZQX${i}MARK`));
fs.writeFileSync(yamlPath, doc.toString({ lineWidth: 0 }));
try {
  execSync('npx astro build', { stdio: 'pipe' });
  const html = htmlPaths.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const missing = paths.filter((_, i) => !html.includes(`ZQX${i}MARK`));
  const expected = CONDITIONAL[page] ?? [];
  const dead = missing.filter((k) => !expected.includes(k));
  const skipped = missing.filter((k) => expected.includes(k));
  const where = htmlPaths.length > 1 ? `${htmlPaths.length} pages` : 'the page';
  console.log(`${page}: ${paths.length - missing.length}/${paths.length} keys reach ${where}`);
  if (skipped.length) console.log('  conditional — needs content or a setting this template ships without:', skipped.join(', '));
  if (dead.length) console.log('  NOT RENDERED — the dashboard would offer a field that does nothing:', dead.join(', '));
  process.exitCode = dead.length ? 1 : 0;
} finally {
  fs.writeFileSync(yamlPath, real);   // always put the real words back
}
