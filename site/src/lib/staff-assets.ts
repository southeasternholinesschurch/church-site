/**
 * Portraits for staff entries, keyed by the `photo` value in each markdown file.
 *
 * Resolved by GLOB, not by one import line per person. That distinction is the
 * whole reason a staff photo can be changed without a developer: previously,
 * adding someone meant dropping in a file, writing an `import`, and adding a
 * key — three edits, two of them TypeScript. Nothing that edits content can do
 * that. Now the filename IS the key, so `photo: peter-vance` resolves to
 * assets/staff/peter-vance.jpg the moment that file exists.
 *
 * Still typo-proof in the same way as before: an unmapped or absent key renders
 * a visible "Photo needed" marker rather than breaking the build.
 *
 * The general photo library is included as a fallback layer so anyone without a
 * proper portrait can still be given a pulpit or teaching shot; assets/staff/
 * wins where both define the same name.
 */
import type { ImageMetadata } from 'astro';

type ImageModule = { default: ImageMetadata };

const portraits = import.meta.glob<ImageModule>(
  '../assets/staff/*.{jpg,jpeg,png,webp,avif}', { eager: true });
const library = import.meta.glob<ImageModule>(
  '../assets/photos/*.{jpg,jpeg,png,webp,avif}', { eager: true });

/** assets/staff/peter-vance.jpg -> "peter-vance" */
const slugOf = (path: string) => path.split('/').pop()!.replace(/\.[^.]+$/, '');

const keyed = (mods: Record<string, ImageModule>) =>
  Object.fromEntries(Object.entries(mods).map(([p, m]) => [slugOf(p), m.default]));

export const STAFF_PHOTOS: Partial<Record<string, ImageMetadata>> = {
  ...keyed(library),
  ...keyed(portraits),
};
