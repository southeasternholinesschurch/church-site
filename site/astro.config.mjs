import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Fairhaven Community Church — public site
// Static output, deployed to Cloudflare Pages. See docs/README.md for why
// this stack was chosen and how the daily/manual rebuild plumbing works.
export default defineConfig({
  // The only place the origin is configured. It builds the canonical tags and
  // the Contact form's redirect, so it must always name the address the site
  // is actually served from. Cutover from the old Tithely site is done.
  site: 'https://example.org',
  output: 'static',
  image: {
    // Astro's built-in image pipeline (sharp) — automatic WebP + responsive
    // sizes for every image run through <Image />/<Picture />. No manual
    // compression step for editors.
  },
  build: {
    format: 'directory',
  },
  integrations: [
    // robots.txt has always advertised /sitemap-index.xml; until now that URL
    // 404'd, which is the sort of thing Search Console reports as an error
    // forever. The two noindex pages are excluded — listing a page in a
    // sitemap while telling robots not to index it is a contradiction, and
    // the bulletin carries members' and children's names beside their dates.
    sitemap({
      filter: (page) => !/\/(bulletin|admin)\/?$/.test(new URL(page).pathname),
    }),
  ],
});
