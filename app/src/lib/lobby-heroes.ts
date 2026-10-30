/**
 * Hero frames: the one kind of lobby scene a person authors by hand.
 *
 * Every other scene is built from the bulletin and the calendar. A hero frame
 * is a graphic the pastor uploads — a revival poster, the Christmas drama, VBS —
 * shown full screen, with three lines of type set in one bottom corner over a
 * vignette that darkens only that corner:
 *
 *     KICKER            small, letter-spaced capitals in the accent colour
 *     Title             large display type: the name of the event
 *     subtitle          smaller italic, lower contrast: what it is, when
 *
 * Pure: validation, scheduling and the markup live here so the dashboard's
 * editor preview and the screen itself draw the frame from the SAME function,
 * and test/lobby.test.ts can hold both. No `astro:` imports, explicit `.ts`.
 */

/** What the feed carries for each hero frame, and what the editor edits. */
export interface LobbyHero {
  id: number;
  /** Where the full graphic is served from (public, by id). */
  image: string;
  kicker: string;
  title: string;
  subtitle: string;
  corner: HeroCorner;
  tone: HeroTone;
  accent: HeroAccent;
  titleStyle: HeroTitleStyle;
  /** Vignette strength, 0–100. */
  shade: number;
  startsOn: string | null;
  endsOn: string | null;
}

/**
 * Bottom corners only. The top corners belong to the glance layer — the
 * wordmark and the clock bar — and a frame that put its title there would
 * fight them. See the safe-area rules in pages/lobby/index.astro.
 */
export const HERO_CORNERS = ['bottom-right', 'bottom-left'] as const;
export type HeroCorner = (typeof HERO_CORNERS)[number];
/** Dark: a dark vignette under cream type. Light: a cream vignette under ink,
 *  for a pale graphic where a dark corner would look like a stain. */
export const HERO_TONES = ['dark', 'light'] as const;
export type HeroTone = (typeof HERO_TONES)[number];
export const HERO_ACCENTS = ['red', 'gold', 'plain'] as const;
export type HeroAccent = (typeof HERO_ACCENTS)[number];
/** Serif: the site's Instrument Serif. Bold: Texta Black, for a graphic that
 *  is itself busy and needs a heavier title to hold its corner. */
export const HERO_TITLE_STYLES = ['serif', 'bold'] as const;
export type HeroTitleStyle = (typeof HERO_TITLE_STYLES)[number];

/** Lengths that still fit the corner at the size the design wants. */
export const HERO_LIMITS = { kicker: 40, title: 48, subtitle: 110 } as const;

/**
 * A hero frame stays up longer than anything else — it is the one thing on the
 * wall somebody made on purpose, and a poster wants looking at.
 */
export const HERO_SECONDS = 26;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type HeroFields = Omit<LobbyHero, 'id' | 'image'>;

/**
 * Check what the editor sent. Server-side, because a form can be replayed
 * without the editor in front of it, and everything here ends up on a wall.
 * Text is trimmed and whitespace collapsed; nothing is silently truncated —
 * an over-long title is an error the editor shows, not a title cut short.
 */
export function validateHero(input: Record<string, unknown>):
  { ok: true; value: HeroFields } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const str = (k: string) => String(input[k] ?? '').replace(/\s+/g, ' ').trim();
  const pick = <T extends string>(k: string, allowed: readonly T[], fallback: T): T => {
    const v = str(k);
    if (!v) return fallback;
    if ((allowed as readonly string[]).includes(v)) return v as T;
    errors.push(`${k} must be one of ${allowed.join(', ')}`);
    return fallback;
  };
  const date = (k: string): string | null => {
    const v = str(k);
    if (!v) return null;
    if (!DATE.test(v) || Number.isNaN(Date.parse(`${v}T12:00:00Z`))) { errors.push(`${k} is not a date`); return null; }
    return v;
  };

  const kicker = str('kicker'), title = str('title'), subtitle = str('subtitle');
  if (!title) errors.push('A title is needed');
  for (const [k, v] of [['kicker', kicker], ['title', title], ['subtitle', subtitle]] as const) {
    if (v.length > HERO_LIMITS[k]) errors.push(`The ${k} is ${v.length} characters; ${HERO_LIMITS[k]} fit`);
  }
  const shadeRaw = Number(input.shade ?? 70);
  const shade = Number.isFinite(shadeRaw) ? Math.round(Math.min(100, Math.max(0, shadeRaw))) : 70;
  const startsOn = date('startsOn'), endsOn = date('endsOn');
  if (startsOn && endsOn && endsOn < startsOn) errors.push('The last day is before the first');

  const value: HeroFields = {
    kicker, title, subtitle, shade, startsOn, endsOn,
    corner: pick('corner', HERO_CORNERS, 'bottom-right'),
    tone: pick('tone', HERO_TONES, 'dark'),
    accent: pick('accent', HERO_ACCENTS, 'red'),
    titleStyle: pick('titleStyle', HERO_TITLE_STYLES, 'serif'),
  };
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** The frames due on a church-time date, in the order the feed gave them. */
export function heroesFor(heroes: LobbyHero[], today: string): LobbyHero[] {
  return heroes.filter((h) => (!h.startsOn || h.startsOn <= today) && (!h.endsOn || h.endsOn >= today));
}

/* ==== drawing a frame ===================================================== */

const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The title's size from its length, so a two-word title is set large and a
 * long one still fits the corner in two or three lines. Pixels on the 1920
 * stage; the bold face is set smaller because it is wider.
 */
export function heroTitleSize(title: string, style: HeroTitleStyle): number {
  const n = title.length;
  const serif = n <= 14 ? 172 : n <= 22 ? 148 : n <= 32 ? 124 : 104;
  return style === 'bold' ? Math.round(serif * .78) : serif;
}

/**
 * The frame's markup, shared by the screen and the editor's preview.
 *
 * Each word of the title sits in its own mask so it can rise into place —
 * the reveal works however the title wraps, which a per-line reveal could not
 * know in advance. `--w` orders the words.
 */
export function heroHtml(h: Pick<LobbyHero, 'image' | 'kicker' | 'title' | 'subtitle' | 'corner' | 'tone' | 'accent' | 'titleStyle' | 'shade'>): string {
  const list = h.title.split(/\s+/).filter(Boolean);
  const words = list.map((w, i) => `<span class="hw"><span style="--w:${i}">${esc(w)}</span></span>`).join(' ');
  const shade = Math.min(100, Math.max(0, h.shade)) / 100;
  return `<div class="hero-frame" data-corner="${esc(h.corner)}" data-tone="${esc(h.tone)}" data-accent="${esc(h.accent)}" data-style="${esc(h.titleStyle)}" style="--shade:${shade};--n:${list.length}">`
    + '<div class="hero-img"><div class="hero-zoom">'
    + `<img src="${esc(h.image)}" alt="" />`
    + '</div></div>'
    + '<div class="hero-shade"></div>'
    + '<div class="hero-text">'
    + (h.kicker ? `<span class="hero-rule"></span><p class="hero-kicker">${esc(h.kicker)}</p>` : '')
    + `<h1 class="hero-title" style="font-size:${heroTitleSize(h.title, h.titleStyle)}px">${words}</h1>`
    + (h.subtitle ? `<p class="hero-sub">${esc(h.subtitle)}</p>` : '')
    + '</div></div>';
}
