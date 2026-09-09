/**
 * Photos and logos per ministry.
 *
 * Mapped in code rather than named in the content files: there is a fixed set
 * of ministries and a fixed set of assets, so a filename in frontmatter would
 * only add a way to break the build. Shared between the ministries index and
 * each ministry's own page so the two can never disagree.
 *
 * A gap here is deliberate and visible, not silent: a ministry without a logo
 * simply shows its name, and one without a photo shows a panel tinted in its
 * own colour. Nothing looks broken, so you can ship before you have everything.
 *
 * Crop photos to about 2400px wide — that is the largest size these pages ever
 * request, and a 6000px original is 10MB committed to serve a quarter of it.
 */
import type { ImageMetadata } from 'astro';

import kidsPhoto from '../assets/photos/kids-pews.jpg';
import youthPhoto from '../assets/photos/youth-row.jpg';
import menPhoto from '../assets/photos/men-men.jpg';
import womenPhoto from '../assets/photos/ladies-talking.jpg';
import seniorsPhoto from '../assets/photos/seniors-conversation.jpg';

/**
 * LOGOS ARE FOR DARK GROUNDS. A mark that reads on ink usually washes out on
 * cream, which is why the ministries index (cream) shows names rather than
 * marks. Check contrast both ways before adding one — aim for 4.5:1 against
 * whatever it actually sits on.
 */
import kidsMark from '../assets/brand/kids-wordmark.png';
import youthMark from '../assets/brand/youth-mark-trimmed.png';
import menMark from '../assets/brand/men-wordmark-on-dark.png';

export const MINISTRY_PHOTOS: Partial<Record<string, ImageMetadata>> = {
  kids: kidsPhoto,
  youth: youthPhoto,
  men: menPhoto,
  women: womenPhoto,
  seniors: seniorsPhoto,
};

export const MINISTRY_LOGOS: Partial<Record<string, ImageMetadata>> = {
  kids: kidsMark,
  youth: youthMark,
  men: menMark,
};

/**
 * Where to hold the crop when a photo is cut to fit.
 *
 * The hero is far wider than most photographs, so `object-fit: cover` throws
 * away the top and bottom. Centred is right for a wide shot of a room and wrong
 * for a portrait, where the centre of the frame is a chest and the face is
 * above it. Measure against YOUR photo rather than guessing.
 */
export const MINISTRY_PHOTO_FOCUS: Record<string, string> = {
  // men: '50% 35%',
  // seniors: '50% 22%',
};

/**
 * How hard the hero parallaxes, per ministry.
 *
 * The two numbers are locked together. `.par` applies
 * `scale(drift-scale) translateY(py)`, so the scale exists to hide the edges
 * the translate would otherwise expose: at a 714px hero, a scale of S conceals
 * (S − 1) × 714 ÷ 2 pixels at each edge, and that must be at least `drift`.
 * Lower the scale without lowering the drift and the photo slides off its own
 * frame mid-scroll.
 *
 * The cost of scale is horizontal: it crops (S − 1) ÷ 2 off each side. If a
 * photo has something important near an edge, reduce both numbers together.
 */
export const MINISTRY_HERO_MOTION: Record<string, { scale: number; drift: number }> = {
  // women: { scale: 1.15, drift: 45 },
};

export const DEFAULT_HERO_MOTION = { scale: 1.28, drift: 80 };

export const MINISTRY_PHOTO_ALT: Record<string, string> = {
  kids: 'Children listening together during the children’s ministry',
  youth: 'A row of teenagers sitting together during a service',
  men: 'Men of the church standing and talking together after a service',
  women: 'Two women of the church talking together after a service',
  seniors: 'Two older members of the church talking and laughing together',
};
