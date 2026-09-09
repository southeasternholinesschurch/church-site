// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

/**
 * The STAFF APP — server-rendered, unlike the public site next door.
 *
 * `output: 'server'` and the Cloudflare adapter are correct HERE and wrong
 * over in site/. The public site is static files precisely so it cannot break;
 * this one has to run code on every request (who is signed in, save this
 * attendance), which is the whole reason it exists as a separate project.
 *
 * Nothing in here is public. Every route except the login flow is behind the
 * session check in src/middleware.ts.
 */
export default defineConfig({
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  site: 'https://app.example.org',
  devToolbar: { enabled: false },
});
