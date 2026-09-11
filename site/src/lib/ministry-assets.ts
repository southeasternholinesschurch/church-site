/**
 * Photos and logos per ministry.
 *
 * Mapped in code rather than named in the content files: there are four fixed
 * ministries and a fixed set of site assets, so a filename in frontmatter would
 * only add a way to break the build. Shared between the ministries index and
 * each ministry's own page so the two can never disagree.
 *
 * Gaps are deliberate and visible, not silent. All four ministries now have a
 * photo; only Fairhaven Kids and Fairhaven Youth have real logos — the pages render a marker
 * where one is missing rather than quietly leaving a hole.
 * Fairhaven Seniors' photo is one of the church's own seniors, chosen by the pastor
 * (IMG_9106, 2026-09-02) — it replaced a wider "standing to sing" shot because
 * a face in conversation says more about that ministry than a room does. It
 * stays until real branding arrives.
 *
 * Photos here are 2400px wide, matching the largest size the ministry pages
 * request. The originals in photos-for-design/ are 6000px and ~10MB; putting
 * one in the repo at full size would commit 10MB to serve 2400px of it.
 */
import type { ImageMetadata } from 'astro';

/**
 * Both trimmed to their artwork. The supplied files carry large empty margins,
 * so untrimmed they render at roughly half their intended size inside any
 * fixed box — the same fault the masthead had.
 *
 * Fairhaven Kids is the horizontal lockup the pastor supplied 2026-08-30, replacing the
 * portrait crown-over-wordmark version. Both marks are now landscape (2.05:1
 * and 3.72:1), so a shared max-height sizes them consistently.
 *
 * DARK GROUNDS ONLY, all three. Fairhaven Kids and Fairhaven Youth are pale pastel with white
 * outlining; Fairhaven Men's is the light tan version the pastor supplied 2026-09-02. All
 * read on ink and wash out on cream — measured, not guessed: Fairhaven Men's light mark
 * is 10.45:1 against the hero's ink and 1.51:1 against cream, and its dark
 * green sibling is the reverse. Hence no logos on the ministries index, which
 * is cream.
 *
 * A dark-on-light version of Fairhaven Men's mark exists if a cream placement is ever
 * wanted; it is deliberately not in the repo while nothing renders it.
 */
import kidsMark from '../assets/brand/kids-wordmark.png';
import youthMark from '../assets/brand/youth-mark-trimmed.png';

import sentMark from '../assets/brand/men-wordmark-on-dark.png';

/**
 * Ministry hero photographs, keyed by FILENAME — the same technique as staff
 * portraits. A ministry's frontmatter names its photo, so changing one is
 * committing a file and editing a line of content, not editing TypeScript.
 *
 * The logos below stay in code deliberately: they carry measured contrast
 * reasoning (one of them is 1.51:1 against cream, which is why no logos appear
 * on the ministries index) and a casual swap would break accessibility
 * silently.
 */
type ImageModule = { default: ImageMetadata };
const photoFiles = import.meta.glob<ImageModule>(
  '../assets/photos/*.{jpg,jpeg,png,webp,avif}', { eager: true });

export const MINISTRY_PHOTOS: Partial<Record<string, ImageMetadata>> =
  Object.fromEntries(Object.entries(photoFiles).map(
    ([path, mod]) => [path.split('/').pop()!.replace(/\.[^.]+$/, ''), mod.default]));


export const MINISTRY_LOGOS: Partial<Record<string, ImageMetadata>> = {
  sent: sentMark,
  kids: kidsMark,
  youth: youthMark,
};

/**
 * Fallback crop position, used when a ministry's frontmatter does not set
 * `photoFocus`. Centre is right for a wide shot of a room and wrong for a
 * portrait, where the middle of the frame is a chest — so the per-ministry
 * value lives with the photo it was measured against, in the content file.
 */
export const DEFAULT_PHOTO_FOCUS = '50% 50%';


/**
 * How hard the hero parallaxes, per ministry.
 *
 * The two numbers are locked together and cannot be tuned separately. `.par`
 * applies `scale(drift-scale) translateY(py)`, so the scale exists to hide the
 * edges the translate would otherwise expose: at a 714px-tall hero, a scale of
 * S conceals (S − 1) × 714 ÷ 2 pixels at each edge, and that has to be at least
 * `drift`. Lower the scale without lowering the drift and the photo slides off
 * its own frame mid-scroll.
 *
 * The cost of that scale is horizontal: it crops (S − 1) ÷ 2 off each side, and
 * Fairhaven Ladies puts the woman's raised hand about 8% in from the right edge — the
 * default 1.28 (≈11% a side) took her hand off. Less zoom, less drift, and she
 * stays whole; 1.15 hides 54px a side, which covers the reduced 45px drift.
 */
export const MINISTRY_HERO_MOTION: Record<string, { scale: number; drift: number }> = {
  seladies: { scale: 1.15, drift: 45 },
};

export const DEFAULT_HERO_MOTION = { scale: 1.28, drift: 80 };

export const MINISTRY_PHOTO_ALT: Record<string, string> = {
  sent: 'Men of the church standing and talking together after a service',
  kids: 'Children listening together during Fairhaven Kids',
  seladies: 'Two women of the church talking together after a service',
  youth: 'A row of teenagers sitting together and listening during a service',
  seseniors: 'Two members of the church talking and laughing together after a service',
};
