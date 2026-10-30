/**
 * The lobby screen's browser half: the stage, the programme loop, the clock,
 * the hand-off between scenes, and the TV remote.
 *
 * lib/lobby.ts decides WHAT to show (and is tested under Node); this file only
 * draws it and keeps time. The motion it relies on is in the page's
 * stylesheet, and the reasons for both are in handoff/DESIGN-lobby-screen.md.
 *
 * It never reloads to change scene and never navigates. A failed fetch keeps
 * the last good feed; a missing photograph waits a few seconds and then shows
 * the scene anyway; and whatever happens there is always something on screen.
 */
import {
  CHANNELS, CHANNEL_LABEL, FALLBACK_SERVICE_TIMES, FULL_REFRESH_MS, IDLE_MS, POLL_MS, SEASON_LABEL, screenPhotos,
  bulletinWhen, clockParts, clockText, countdownText, materialFor, minutesUntil, nextService, phaseAt, scenesFor, seasonFor,
  sermonWhen, shouldReload, stepChannel, zonedInstant,
  type Channel, type LobbyFeed, type NextService, type Scene, type Season, type SceneContext,
} from './lobby.ts';
import { CHURCH_TZ } from './services.ts';
import { heroHtml } from './lobby-heroes.ts';
import { copyText } from './lobby-copy.ts';

/** How long an outgoing scene stays under the incoming one. Matches the CSS. */
const HANDOFF_MS = 3200;
/** How long to wait for a photograph before showing its scene regardless. */
const PHOTO_WAIT_MS = 4000;

const EMPTY: LobbyFeed = {
  generatedAt: '', churchName: 'Fairhaven Community Church', address: '',
  serviceTimes: FALLBACK_SERVICE_TIMES, bulletin: null, events: [], qr: {},
  links: { site: 'yourchurch.org', livestream: '', events: '', visit: '', give: '', guest: '' }, heroes: [], copy: {},
};

/* ---- small helpers ------------------------------------------------------- */

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A line of a scene, revealed in reading order by `n`. */
const L = (n: number, cls: string, html: string, tag = 'p', style = '') =>
  `<${tag} class="m-line ${cls}" style="--i:${n};${style}">${html}</${tag}>`;

/** "Sunday Morning Worship" → "Morning Worship"; "Sunday School" stays whole. */
function shortName(label: string): string {
  const rest = label.replace(/^(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)\s+/, '');
  return rest.split(/\s+/).length >= 2 ? rest : label;
}

function dayWord(n: NextService): string {
  if (n.daysAway === 0) return 'Today';
  if (n.daysAway === 1) return 'Tomorrow';
  return new Date(`${n.date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

const longDate = (d: Date) =>
  d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: CHURCH_TZ });
const isoLong = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const clock12 = (minutes: number) => clockText(minutes).replace(/\s[ap]m$/, '');

/** A number that changes gracefully: see `.tick` in the page's stylesheet. */
const tickHtml = (v: string | number) => `<span class="tick"><span class="in">${esc(v)}</span></span>`;
function setTick(el: Element, v: string) {
  if ((el as HTMLElement).dataset.v === v) return;
  const was = el.querySelector('.in')?.textContent ?? '';
  (el as HTMLElement).dataset.v = v;
  el.innerHTML = was
    ? `<span class="tick"><span class="out" aria-hidden="true">${esc(was)}</span><span class="in">${esc(v)}</span></span>`
    : tickHtml(v);
}

/* ---- state --------------------------------------------------------------- */

const q = new URLSearchParams(location.search);
/** `?at=` shifts the clock to a church-time moment; time then runs on from it. */
const offset = (() => {
  const t = q.get('at') ? zonedInstant(q.get('at')!) : null;
  return t ? t.getTime() - Date.now() : 0;
})();
const now = () => new Date(Date.now() + offset);
const seasonParam = q.get('season') as Season | null;
const sceneParam = q.get('scene');
const heldByUrl = q.has('hold') || !!sceneParam;

let feed: LobbyFeed = EMPTY;
let channel: Channel = (CHANNELS as string[]).includes(q.get('channel') ?? '') ? q.get('channel') as Channel : 'programme';
let paused = heldByUrl;
let list: Scene[] = [];
let index = 0;
let lap = 0;
let z = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let showing = 0;
let lastInput = 0;
let shape = '';
let started = false;
const loadedAt = Date.now();

function context(): SceneContext {
  const n = now();
  const clock = clockParts(n);
  return { now: n, clock, phase: phaseAt(clock, feed.serviceTimes), lap };
}

/** What the programme depends on, as a string: when it changes, rebuild. */
function shapeOf(c: SceneContext): string {
  const p = c.phase;
  return [channel, p.phase, p.service?.label, (p.minutesToStart ?? 99) <= 5, c.clock.date].join('|');
}

function rebuild(c = context()) {
  list = scenesFor(channel, feed, c);
  shape = shapeOf(c);
}

/* ---- drawing a scene ----------------------------------------------------- */

/** The photograph a scene sits on: an index into the same list the programme
 *  was built from (built-in ones switched on, then uploads). */
const photoOf = (s: Scene) => { const list = screenPhotos(feed); return list[s.photo ?? 0] ?? list[0]!; };

function photoSrc(s: Scene): string | null {
  if (s.kind === 'hero') return feed.heroes[s.idx?.[0] ?? -1]?.image ?? null;
  return s.photo == null || s.kind === 'night' ? null : photoOf(s).src;
}

function photoHtml(s: Scene, blur = false): string {
  const p = photoOf(s);
  return `<div class="m-photo" data-v="${z % 4}" style="--life:${s.seconds + 6}s">`
    + `<img src="${photoSrc(s)}" alt="${blur ? '' : esc(p.alt)}"${blur ? ' class="blurred"' : ''} style="object-position:${p.pos ?? '50% 50%'}"></div>`;
}

const panel = (pos: string, cls: string, html: string) =>
  `<div class="pos pos--${pos}"><div class="m-panel glass ${cls}">${html}</div></div>`;

/** Whole sentences up to `max` characters: a clipped "cool box o…" reads as
 *  a fault on a wall, where nobody can scroll to the rest. */
function firstSentences(text: string, max: number): string {
  const parts = text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [text];
  let out = '';
  for (const p of parts) { if (out && (out + p).length > max) break; out += p; }
  out = out.trim();
  return out.length <= max ? out : `${out.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

/**
 * A QR code with its quiet zone drawn in: four white modules all round, which
 * is what the standard asks for and what a phone camera across a foyer needs
 * to find the code at all.
 */
const qrSvg = (code: { n: number; d: string }, label: string) =>
  `<svg viewBox="-4 -4 ${code.n + 8} ${code.n + 8}" shape-rendering="crispEdges" role="img" aria-label="${esc(label)}">`
  + `<rect x="-4" y="-4" width="${code.n + 8}" height="${code.n + 8}" fill="#fff"/><path d="${code.d}" fill="#1a1512"/></svg>`;

/**
 * A phrase from the screen's words (lib/lobby-copy.ts), escaped for HTML: what
 * was saved on the Lobby tab, else the default. Every fixed word on every
 * scene comes through here, so all of them can be changed without a deploy.
 */
const w = (key: string, vars: Record<string, string> = {}) => esc(copyText(feed.copy, key, vars));

/** "Saturday 24 Oct · 11:00 AM" as the date, then the time, a line each. */
function whenLines(when: string): string {
  const cut = when.indexOf(' · ');
  return cut < 0 ? `<span>${esc(when)}</span>` : `<span>${esc(when.slice(0, cut))}</span><span>${esc(when.slice(cut + 3))}</span>`;
}

/** Long text gets a smaller size rather than overflowing the panel. */
function quoteSize(text: string): number {
  const words = text.split(/\s+/).length;
  return words > 70 ? 50 : words > 45 ? 60 : 76;
}

function render(s: Scene, c: SceneContext): string {
  const b = feed.bulletin;
  const svc = c.phase.service;
  const next = nextService(c.clock, feed.serviceTimes);
  const season = SEASON_LABEL[(seasonParam ?? seasonFor(c.clock.date))];
  const mins = c.phase.minutesToStart;

  switch (s.kind) {
    case 'welcome': {
      const title = svc?.label ?? next?.label ?? feed.churchName;
      const count = mins != null && svc
        ? L(3, 'countdown', `<span class="t-big" data-tick="mins">${tickHtml(mins)}</span>`
          + `<span class="countdown__words"><span data-plural>${mins === 1 ? 'minute' : 'minutes'}</span> ${w('welcome.until')}`
          + `<span class="t-meta">${clockText(svc.start)} · ${w('welcome.where')}</span></span>`, 'div')
        : next ? L(3, 't-body', `Next: ${esc(dayWord(next))} at ${clockText(next.start)}`) : '';
      return photoHtml(s) + panel('hero', 'hero',
        L(0, 't-label', `${season ? `${season} · ` : ''}${w('welcome.label')} · ${esc(longDate(c.now))}`)
        + L(1, 't-heading', esc(shortName(title)), 'h1') + L(2, 'hair', '', 'div') + count);
    }
    case 'starting': {
      const m = mins ?? 0;
      return photoHtml(s, true) + panel('center', 'card',
        L(0, 't-label', esc(shortName(svc?.label ?? '')))
        + L(1, 't-title', w('starting.beginsIn'))
        + L(2, 't-big', `<span data-tick="mins">${tickHtml(m)}</span> <span class="t-em" style="font-size:120px" data-plural>${m === 1 ? 'minute' : 'minutes'}</span>`)
        + L(3, 't-body', w('starting.ask')));
    }
    case 'quiet': {
      const today = b && bulletinWhen(b.serviceDate, c.clock.date) === 'today';
      return photoHtml(s, true) + panel('center', 'card',
        L(0, 't-label', w('quiet.label'))
        + L(1, 't-heading', w('quiet.headline', { service: shortName(svc?.label ?? 'Worship') }))
        + L(2, 't-body', w('quiet.body'))
        + (today && b.scriptureRef ? L(3, 't-meta', `${w('text.today')} · ${esc(b.scriptureRef)}`) : ''));
    }
    case 'thanks':
      return photoHtml(s) + panel('hero', 'hero',
        L(0, 't-label', w('thanks.label'))
        + (next ? L(1, 't-heading', esc(shortName(next.label)), 'h1')
          + L(2, 'hair', '', 'div') + L(3, 't-body', `${esc(dayWord(next))} · ${clockText(next.start)}`)
          : L(1, 't-heading', w('thanks.fallback'), 'h1')));
    case 'text': {
      if (!b) return '';
      const when = bulletinWhen(b.serviceDate, c.clock.date);
      const label = w(when === 'today' ? 'text.today' : when === 'upcoming' ? 'text.next' : 'text.recent');
      const body = b.scripture
        ? L(1, 't-quote', `“${esc(b.scripture)}”`, 'p', `font-size:${quoteSize(b.scripture)}px`)
        : L(1, 't-heading', esc(b.scriptureRef));
      return photoHtml(s, true) + panel('statement', 'statement',
        L(0, 't-label', label) + body
        + L(2, 'byline', `${b.scripture && b.scriptureRef ? `<span class="t-label" style="font-size:32px">${esc(b.scriptureRef)}</span>` : ''}`
          + `${b.preacher ? `<span class="t-title t-em" style="font-size:48px;color:var(--glass-soft)">${w('text.preaching')} · ${esc(b.preacher)}</span>` : ''}`, 'div'));
    }
    case 'singing': {
      const slots = b?.singing?.slots ?? [];
      return photoHtml(s, true) + panel('list', 'list',
        `<div class="col">${L(0, 't-label', w('singing.label'))}<ul class="rows">${slots.map((x, j) =>
          L(j + 1, '', `<span class="t-label" style="color:var(--glass-soft)">${esc(x.label)}</span><br><span class="t-item">${esc(x.names.join(', ') || x.note)}</span>`, 'li')).join('')}</ul></div>`);
    }
    case 'announcement': {
      const a = b?.announcements[s.idx![0]!];
      if (!a) return '';
      return photoHtml(s) + panel('feature', 'feature',
        `<div class="stack">${L(0, 't-label', a.when ? esc(a.when) : w('announcement.label'))}`
        + L(1, a.heading.length > 26 ? 't-title' : 't-heading', esc(a.heading), 'h2')
        + (a.detail ? L(2, 't-body', esc(a.detail)) : '') + '</div>');
    }
    case 'signup': {
      const x = b?.signups[s.idx![0]!];
      if (!x) return '';
      const code = feed.qr[x.url];
      return photoHtml(s) + panel('feature', 'feature',
        `<div class="stack">${L(0, 't-label', w('signup.label'))}`
        + L(1, x.title.length > 26 ? 't-title' : 't-heading', esc(x.title), 'h2')
        + (x.when ? L(2, 't-meta', esc(x.when), 'p', 'color:var(--glass-ink);font-weight:700') : '')
        + (x.intro ? L(2, 't-body', esc(firstSentences(x.intro, 150))) : '') + '</div>'
        + (code ? L(3, 'qr', `<div class="qr__code">${qrSvg(code, `QR code for ${x.title}`)}</div>`
          + `<div class="t-meta" style="color:var(--glass-ink)"><b>${w('signup.scan')}</b><br><span style="color:var(--glass-soft)">${w('signup.note')}</span></div>`, 'div') : ''));
    }
    case 'give':
    case 'guest': {
      const k = s.kind;
      const url = s.kind === 'give' ? feed.links.give : feed.links.guest;
      const code = url ? feed.qr[url] : undefined;
      // The photograph as a sharp strip across the top, placed on the faces
      // (the band below would otherwise cover them), fading into a blurred
      // copy of itself behind the glass.
      const p = photoOf(s);
      const face = p.face;
      // A 3:2 photograph is 1280 px tall at stage width, the strip is 640, and
      // about the top 380 of it shows above the band: centre the faces in that.
      const y = Math.round(Math.min(1, Math.max(0, (face * 1280 - 190) / 640)) * 100);
      const strip = `<div class="m-photo m-photo--strip" data-v="${z % 4}" style="--life:${s.seconds + 6}s">`
        + `<img src="${photoSrc(s)}" alt="${esc(p.alt)}" style="object-position:50% ${y}%"></div>`;
      return photoHtml(s, true) + strip + panel('shelf', 'invite',
        `<div class="invite__words">${L(0, 't-label', w(`${k}.label`))}`
        + L(1, 't-heading invite__head', `${w(`${k}.head`)} <em>${w(`${k}.em`)}</em>`, 'h2')
        + L(2, 't-body', w(`${k}.body`)) + '</div>'
        + L(3, 'invite__code', (code ? `<div class="qr__code">${qrSvg(code, copyText(feed.copy, `${k}.scan`))}</div>` : '')
          + `<p class="invite__scan">${w(`${k}.scan`)}</p><p class="t-meta">${w(`${k}.note`)}</p>`
          + `<p class="t-meta invite__addr">${w(`${k}.addr`)}</p>`, 'div'));
    }
    case 'sermon': {
      const x = feed.sermon;
      const when = sermonWhen(x, c.clock.date);
      if (!x || !when) return '';
      const code = feed.qr[x.url];
      // Same shelf as the invitations — words, then the sermon as a card, then
      // the code where the eye finishes — over the whole photograph.
      return photoHtml(s) + panel('shelf', 'invite invite--sermon',
        `<div class="invite__words">${L(0, 't-label', w(when === 'today' ? 'sermon.labelToday' : 'sermon.label'))}`
        + L(1, 't-heading invite__head', `${w('sermon.head')} <em>${w('sermon.em')}</em>`, 'h2') + '</div>'
        + L(2, 'sermon-card', `<p class="t-meta sermon-card__date">${esc(isoLong(x.date))}</p>`
          + `<p class="t-title sermon-card__title">${esc(x.title)}</p>`
          + '<dl class="sermon-card__facts">'
          + (x.speaker ? `<div><dt>${w('sermon.speaker')}</dt><dd>${esc(x.speaker)}</dd></div>` : '')
          + (x.scripture ? `<div><dt>${w('sermon.scripture')}</dt><dd>${esc(x.scripture.replace(/(\d)-(\d)/g, '$1–$2'))}</dd></div>` : '')
          + '</dl>', 'div')
        + L(3, 'invite__code', (code ? `<div class="qr__code">${qrSvg(code, `QR code for ${x.title}`)}</div>` : '')
          + `<p class="invite__scan">${w('sermon.scan')}</p><p class="t-meta">${w(x.hasTranscript ? 'sermon.note' : 'sermon.noteVideo')}</p>`
          + `<p class="t-meta invite__addr">${w('sermon.addr')}</p>`, 'div'));
    }
    case 'notice': {
      const n = feed.settings?.notice;
      if (!n) return '';
      return photoHtml(s, true) + panel('statement', 'statement',
        L(0, 't-label', w('notice.label'))
        + L(1, n.title.length > 30 ? 't-title' : 't-heading', esc(n.title), 'h2')
        + (n.detail ? L(2, 't-body', esc(n.detail)) : ''));
    }
    case 'prayer': {
      const items = (s.idx ?? []).map((j) => b?.prayerRequests[j]).filter(Boolean) as string[];
      const page = s.page && s.page[1] > 1 ? ` <span class="t-meta">· ${s.page[0]} of ${s.page[1]}</span>` : '';
      return photoHtml(s, true) + panel('list', 'list',
        `<div class="col">${L(0, 't-label', `${w('prayer.label')}${page}`)}`
        + `<ul class="rows" style="display:grid;grid-template-columns:1fr 1fr;grid-template-rows:repeat(${Math.ceil(items.length / 2)},auto);grid-auto-flow:column;column-gap:96px">`
        + items.map((t, j) => L(j + 1, 't-item', esc(t), 'li')).join('') + '</ul></div>');
    }
    case 'celebrations': {
      const cel = b?.celebrations;
      if (!cel) return '';
      // `idx` holds this page's birthdays, then its anniversaries; `split` says
      // where one list ends (see celebrationPages in lib/lobby.ts).
      const bIdx = (s.idx ?? []).slice(0, s.split ?? 0), aIdx = (s.idx ?? []).slice(s.split ?? 0);
      const more = s.page && s.page[1] > 1 ? ` <span class="t-meta">· ${s.page[0]} of ${s.page[1]}</span>` : '';
      const chips = (xs: { day: number; name: string }[], from: number) =>
        `<ul class="chips">${xs.map((x, j) => L(from + j, '', `<span class="chip-day">${x.day}</span>${esc(x.name)}`, 'li')).join('')}</ul>`;
      return photoHtml(s, true) + panel('list', 'list',
        (bIdx.length ? `<div class="col">${L(0, 't-label', `${w('celebrations.birthdays', { month: cel.month })}${more}`)}${chips(bIdx.map((j) => cel.birthdays[j]!), 1)}</div>` : '')
        + (aIdx.length ? `<div class="col" style="flex:0 1 auto">${L(1, 't-label', `${w('celebrations.anniversaries', { month: cel.month })}${bIdx.length ? '' : more}`)}${chips(aIdx.map((j) => cel.anniversaries[j]!), 2)}</div>` : ''));
    }
    case 'hero': {
      const h = feed.heroes[s.idx?.[0] ?? -1];
      return h ? heroHtml(h) : '';
    }
    case 'events': {
      const page = s.page && s.page[1] > 1 ? ` <span class="t-meta">· ${s.page[0]} of ${s.page[1]}</span>` : '';
      return photoHtml(s) + panel('shelf', 'shelf',
        L(0, 't-label', `${w(s.key.startsWith('week') ? 'events.week' : 'events.coming')}${page}`)
        + `<div class="events" style="--n:${(s.idx ?? []).length}">${(s.idx ?? []).map((j, k) => {
          const e = feed.events[j]!;
          return L(k + 1, 'event', `<div class="dateblock${e.dateBlock.isRange ? ' dateblock--range' : ''}"><div><b>${esc(e.dateBlock.month)}</b><span>${esc(e.dateBlock.day)}</span></div></div>`
            + `<div class="event__text"><div class="event__title">${esc(e.title)}</div><div class="t-meta event__when">${whenLines(e.when)}</div></div>`, 'div');
        }).join('')}</div>`);
    }
    case 'next-sunday': {
      if (!b) return '';
      return photoHtml(s) + panel('hero', 'hero',
        L(0, 't-label', `${w('nextSunday.label')} · ${esc(isoLong(b.serviceDate).replace(/^\w+, /, ''))}`)
        + L(1, 't-heading', esc(b.scriptureRef || b.title), 'h1')
        + (b.scripture ? L(2, 't-title t-em clamp3', `“${esc(b.scripture)}”`) : '')
        + (b.preacher ? L(3, 't-meta', `${w('text.preaching')} · ${esc(b.preacher)}`) : ''));
    }
    case 'services':
      return photoHtml(s) + panel('hero', 'hero',
        L(0, 't-label', w('services.label'))
        + L(1, 'services', feed.serviceTimes.map((t, k, all) => {
          const m = /^(\d{1,2}):(\d{2})$/.exec(t.time);
          const time = m ? clockText(Number(m[1]) * 60 + Number(m[2])) : t.time;
          // The day once per group: three Sundays in a row read as a stutter.
          const day = all[k - 1]?.day === t.day ? '' : esc(t.day);
          return `<span class="t-meta" style="color:var(--glass-ink);font-weight:700">${day}</span><span class="t-meta">${time}</span><span class="t-title">${esc(shortName(t.label))}</span>`;
        }).join(''), 'div'));
    case 'night':
      return `<div class="m-photo m-photo--night"></div><div class="night">`
        + `<p class="t-big" data-tick="clock">${tickHtml(clock12(c.clock.minutes))}</p>`
        + `<p class="t-meta" style="color:inherit">${esc(longDate(c.now))}</p>`
        + (next ? `<p class="t-meta" style="color:inherit">${esc(shortName(next.label))} · ${esc(dayWord(next))} ${clockText(next.start)}</p>` : '')
        + '</div>';
  }
}

/**
 * The last of the safe-area rules (see `.pos` in the page's stylesheet): a
 * panel whose content is taller than the safe area is set slightly smaller,
 * in steps, down to 78%. Lists are paginated long before this, so in practice
 * it catches a long announcement or a long passage of scripture. If even 78%
 * will not fit, the panel's own clip holds and the console says so — the
 * clock bar and the progress line are never overlapped either way.
 */
function fitPanels(root: HTMLElement) {
  for (const panel of root.querySelectorAll<HTMLElement>('.m-panel')) {
    let f = 1;
    while (panel.scrollHeight > panel.clientHeight + 1 && f > 0.78) {
      f = Math.round((f - 0.04) * 100) / 100;
      for (const c of panel.children) (c as HTMLElement).style.zoom = String(f);
    }
    if (panel.scrollHeight > panel.clientHeight + 1) {
      console.warn('lobby: a panel is taller than the safe area even at 78%', root.dataset.key);
    }
  }
}

/* ---- the hand-off -------------------------------------------------------- */

function preload(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    const done = () => resolve();
    img.onload = () => (img.decode ? img.decode().then(done, done) : done());
    img.onerror = done;
    img.src = src;
    setTimeout(done, PHOTO_WAIT_MS);
  });
}

async function show(i: number) {
  clearTimeout(timer);
  if (!list.length) rebuild();
  index = ((i % list.length) + list.length) % list.length;
  const scene = list[index]!;
  const token = ++showing;
  const src = photoSrc(scene);
  // Never dissolve into a half-loaded photograph: wait for it, briefly.
  if (src) await preload(src);
  if (token !== showing) return;

  const c = context();
  const scenes = $('scenes');
  const layer = document.createElement('div');
  layer.className = 'layer entering';
  layer.dataset.material = materialFor(c.clock);
  layer.dataset.key = scene.key;
  layer.style.zIndex = String(++z);
  layer.innerHTML = render(scene, c);

  const frame = layer.querySelector<HTMLElement>('.hero-frame');
  if (frame) {
    frame.classList.add('is-playing');
    frame.style.setProperty('--life', `${scene.seconds + 2}s`);
  }

  for (const old of scenes.querySelectorAll<HTMLElement>('.layer:not(.leaving)')) {
    old.classList.replace('entering', 'leaving');
    old.querySelector('.hero-frame')?.classList.add('is-leaving');
    // Still painted for the hand-off, but no longer content.
    old.setAttribute('aria-hidden', 'true');
    old.inert = true;
    setTimeout(() => old.remove(), HANDOFF_MS);
  }
  scenes.appendChild(layer);
  fitPanels(layer);
  document.body.classList.toggle('is-night', scene.kind === 'night');
  drawProgress();
  schedule();
  // The next photograph loads while this scene is up.
  const nextSrc = list.length > 1 ? photoSrc(list[(index + 1) % list.length]!) : null;
  if (nextSrc) void preload(nextSrc);
}

function schedule() {
  clearTimeout(timer);
  if (paused || list.length < 2) return;
  timer = setTimeout(advance, list[index]!.seconds * 1000);
}

function advance() {
  if (index + 1 < list.length) return void show(index + 1);
  lap++;
  rebuild();
  void show(0);
}

function drawProgress() {
  const el = $('progress');
  // One scene means no rotation, so nothing to count down.
  if (list.length < 2) { el.innerHTML = ''; return; }
  const n = Math.min(list.length, 16);
  const at = list.length > 16 ? 0 : index;
  el.innerHTML = Array.from({ length: n }, (_, j) =>
    `<i class="${j < at ? 'done' : j === at ? 'now' : ''}"${j === at ? ` style="--dur:${list[index]!.seconds}s"` : ''}></i>`).join('');
}

/* ---- the glance layer ---------------------------------------------------- */

function drawGlance(c: SceneContext) {
  setTick($('clock'), clock12(c.clock.minutes));
  const p = c.phase;
  // Always counting down to the next service — morning, then evening, then
  // Wednesday — moving on the moment the current one begins.
  const next = nextService(c.clock, feed.serviceTimes);
  const text = next ? `${shortName(next.label)} in ${countdownText(minutesUntil(next, c.now))}` : '';
  const el = $('next');
  if (el.dataset.v !== text) { el.dataset.v = text; el.textContent = text; }

  // Countdowns inside the current scene tick with the clock.
  for (const t of document.querySelectorAll('.layer:not(.leaving) [data-tick="mins"]')) setTick(t, String(p.minutesToStart ?? 0));
  for (const t of document.querySelectorAll('.layer:not(.leaving) [data-plural]')) t.textContent = p.minutesToStart === 1 ? 'minute' : 'minutes';
  for (const t of document.querySelectorAll('.layer:not(.leaving) [data-tick="clock"]')) setTick(t, clock12(c.clock.minutes));
}

let hudTimer: ReturnType<typeof setTimeout> | undefined;
function hud(text: string) {
  const el = $('hud');
  el.hidden = true;
  void el.offsetWidth;            // restart the arrival animation
  el.textContent = text;
  el.hidden = false;
  clearTimeout(hudTimer);
  hudTimer = setTimeout(() => { el.hidden = true; }, 3000);
}

/* ---- the remote ---------------------------------------------------------- */

function setPaused(on: boolean) {
  paused = on;
  document.body.classList.toggle('is-paused', on);
  if (on) clearTimeout(timer); else { drawProgress(); schedule(); }
}

function toChannel(ch: Channel, label = CHANNEL_LABEL[ch]) {
  channel = ch;
  rebuild();
  hud(label);
  void show(0);
}

function onKey(e: KeyboardEvent) {
  lastInput = Date.now();
  switch (e.key) {
    case 'ArrowRight': void show(index + 1); break;
    case 'ArrowLeft': void show(index - 1); break;
    case 'ArrowDown': toChannel(stepChannel(channel, 1)); break;
    case 'ArrowUp': toChannel(stepChannel(channel, -1)); break;
    case 'Enter': case ' ': setPaused(!paused); hud(paused ? 'Paused' : 'Playing'); break;
    case 'Escape': case 'Backspace': case 'GoBack': setPaused(false); toChannel('programme'); break;
    default:
      // Samsung's Back key reports keyCode 10009 and no useful `key`.
      if (e.keyCode !== 10009) return;
      setPaused(false); toChannel('programme');
  }
  e.preventDefault();
}

/* ---- the feed ------------------------------------------------------------ */

/** When the whole feed last arrived; see FULL_REFRESH_MS. */
let fullAt = 0;

async function load(): Promise<void> {
  try {
    // "Has anything changed since this?" The server answers 204 when not,
    // which costs it almost nothing; the whole feed costs it a lot.
    const since = feed.stamp && Date.now() - fullAt < FULL_REFRESH_MS ? feed.stamp : '';
    const res = await fetch(since ? `/api/lobby/feed?since=${encodeURIComponent(since)}` : '/api/lobby/feed',
      { cache: 'no-store' });
    if (res.status === 204 || !res.ok) return;   // unchanged, or keep the last good copy
    feed = await res.json() as LobbyFeed;
    fullAt = Date.now();
  } catch { return; }
  // Keep the current scene if it still exists, so a refresh is invisible.
  const key = list[index]?.key;
  rebuild();
  const j = list.findIndex((s) => s.key === key);
  if (j >= 0) { index = j; drawProgress(); } else if (started) void show(0);
}

/* ---- the clock ----------------------------------------------------------- */

function everySecond() {
  const c = context();
  document.body.dataset.season = seasonParam ?? seasonFor(c.clock.date);
  drawGlance(c);

  if (shapeOf(c) !== shape) {
    const key = list[index]?.key;
    rebuild(c);
    const j = list.findIndex((s) => s.key === key);
    if (j >= 0) { index = j; drawProgress(); schedule(); } else void show(0);
  }
  // A minute with nobody touching the remote returns the screen to itself.
  if (!heldByUrl && lastInput && Date.now() - lastInput > IDLE_MS && (channel !== 'programme' || paused)) {
    lastInput = 0;
    setPaused(false);
    toChannel('programme');
  }
  if (!offset && shouldReload(c.clock, Date.now() - loadedAt)) location.reload();
}

function fit() {
  const stage = $('stage');
  (stage.style as CSSStyleDeclaration & { zoom: string }).zoom = String(Math.min(innerWidth / 1920, innerHeight / 1080));
}

export async function start() {
  fit();
  addEventListener('resize', fit);
  addEventListener('keydown', onKey);
  // Show nothing until the first feed arrives, or five seconds pass.
  await Promise.race([load(), sleep(5000)]);
  rebuild();
  if (sceneParam) {
    const j = list.findIndex((s) => s.kind === sceneParam);
    if (j >= 0) index = j;
  }
  setPaused(paused);
  started = true;
  everySecond();
  void show(index);
  setInterval(everySecond, 1000);
  setInterval(load, POLL_MS);
}
