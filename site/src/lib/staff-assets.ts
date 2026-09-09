/**
 * Staff portraits, mapped by KEY rather than filename.
 *
 * The .md files name a key here, not a path, so a typo in content cannot break
 * the build — an unmapped key renders a visible "Photo needed" marker instead.
 *
 * Add a portrait to ../assets/staff/, import it, and give it a key. The keys
 * are what appear in the Decap CMS dropdown (site/public/admin/config.yml).
 */
import type { ImageMetadata } from 'astro';

// import pastor from '../assets/staff/pastor.jpg';

export const STAFF_PHOTOS: Partial<Record<string, ImageMetadata>> = {
  // pastor,
};
