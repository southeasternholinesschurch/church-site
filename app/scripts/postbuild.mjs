#!/usr/bin/env node
/**
 * Keep the SERVER build out of the PUBLIC asset upload.
 *
 * The Astro Cloudflare adapter writes `_worker.js/` (the compiled server — auth
 * logic, session handling, every database query) and `_routes.json` into the
 * same dist/ directory that wrangler uploads as static assets. Without this
 * file, both are served to anyone who asks for them.
 *
 * Wrangler refuses the deploy rather than doing it silently, which is how this
 * was caught. This script makes the exclusion part of the build so it cannot be
 * forgotten — dist/ is wiped on every build, so a hand-made .assetsignore would
 * survive exactly once.
 */
import fs from 'node:fs';
import path from 'node:path';

const dist = path.join(import.meta.dirname, '..', 'dist');
if (!fs.existsSync(dist)) {
  console.error('postbuild: no dist/ — did the build run?');
  process.exit(1);
}

fs.writeFileSync(path.join(dist, '.assetsignore'), '_worker.js\n_routes.json\n');

// Verify rather than assume. A typo here silently publishes the server.
const written = fs.readFileSync(path.join(dist, '.assetsignore'), 'utf8');
if (!written.includes('_worker.js')) {
  console.error('postbuild: .assetsignore does not exclude _worker.js — refusing to continue.');
  process.exit(1);
}
console.log('postbuild: server bundle excluded from the public asset upload.');
