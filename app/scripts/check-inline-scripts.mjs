#!/usr/bin/env node
/**
 * Syntax-check every inline <script> in every .astro page.
 *
 * `astro check` does NOT look inside `is:inline` blocks — they are passed
 * through to the browser untouched — so a typo in one type-checks perfectly
 * and then throws at runtime, in front of whoever opened the page. That is the
 * same family as the trap in the build notes: a clean `astro check` proves very
 * little about a page actually working.
 *
 * This caught a stray character sitting in the middle of a fetch call on the
 * [Kids Ministry] register, which the type-checker was happy with.
 *
 * Parsing only — nothing here is executed, so a script that talks to the DOM is
 * checked as safely as one that does not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath, not .pathname: the project lives under a directory with a
// space in its name, and .pathname hands back the percent-encoded form.
const ROOT = fileURLToPath(new URL('../src', import.meta.url));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

let checked = 0, bad = 0;
for (const file of walk(ROOT).filter((f) => f.endsWith('.astro'))) {
  const src = readFileSync(file, 'utf8');
  // Only inline scripts. A bundled <script> IS processed by Astro and would be
  // reported by the build.
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(src)) !== null) {
    if (!/is:inline/.test(m[1])) continue;
    n++; checked++;
    const body = m[2];
    // Line number of the block, so a failure points somewhere useful.
    const line = src.slice(0, m.index).split('\n').length;
    try {
      // Parses without running. A SyntaxError is the whole point.
      new Function(body);
    } catch (e) {
      bad++;
      console.error(`FAIL ${file.replace(ROOT, 'src')}:${line}  inline script ${n}`);
      console.error(`  ${e.message}`);
    }
  }
}

console.log(bad
  ? `\n${bad} of ${checked} inline scripts FAILED`
  : `ok   ${checked} inline scripts parse`);
if (bad) process.exit(1);
