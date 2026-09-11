/**
 * Artwork for sermons and preaching series, keyed by filename.
 *
 * Same technique as staff portraits: resolved by glob, so the filename IS the
 * key and a graphic can be added by committing a file — no code edit, which is
 * what lets the dashboard do it. See lib/staff-assets.ts for the reasoning.
 *
 * The cascade a page should follow is: this sermon's own image, then its
 * series' artwork, then the YouTube thumbnail. A church with no graphics
 * still gets a usable card and a usable link preview; a church with a series
 * graphic gets it on every sermon in the run without setting it 12 times.
 */
import type { ImageMetadata } from 'astro';

type ImageModule = { default: ImageMetadata };

const seriesArt = import.meta.glob<ImageModule>(
  '../assets/series/*.{jpg,jpeg,png,webp,avif}', { eager: true });
const sermonArt = import.meta.glob<ImageModule>(
  '../assets/sermons/*.{jpg,jpeg,png,webp,avif}', { eager: true });

const slugOf = (path: string) => path.split('/').pop()!.replace(/\.[^.]+$/, '');
const keyed = (mods: Record<string, ImageModule>) =>
  Object.fromEntries(Object.entries(mods).map(([p, m]) => [slugOf(p), m.default]));

export const SERIES_ARTWORK: Partial<Record<string, ImageMetadata>> = keyed(seriesArt);
export const SERMON_ARTWORK: Partial<Record<string, ImageMetadata>> = keyed(sermonArt);

/** The YouTube still, which always exists. Used when nothing has been uploaded. */
export const youtubeThumb = (youtubeId: string) =>
  `https://i.ytimg.com/vi/${youtubeId}/maxresdefault.jpg`;

/**
 * Resolve the best available artwork, as a URL string usable in og:image and
 * structured data. Returns the YouTube still when nothing has been uploaded.
 */
export function artworkUrl(
  opts: { image?: string; seriesArtwork?: string; youtubeId: string; site?: URL },
): string {
  const local = (opts.image && SERMON_ARTWORK[opts.image])
    ?? (opts.seriesArtwork && SERIES_ARTWORK[opts.seriesArtwork]);
  if (local) return opts.site ? new URL(local.src, opts.site).href : local.src;
  return youtubeThumb(opts.youtubeId);
}
