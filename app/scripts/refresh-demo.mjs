#!/usr/bin/env node
/**
 * Bring the PUBLIC DEMO up to date, in one command.
 *
 *   node scripts/refresh-demo.mjs
 *
 * Three steps that have to happen in this order and were previously three
 * things to remember:
 *
 *   1. migrate    — the demo has its own database (seh-demo) and its own
 *                   migration state; the real app's is separate.
 *   2. reseed     — scripts/seed-demo.mjs prints SQL, which is applied here.
 *                   The seed CLEARS what it owns, so this is repeatable.
 *   3. deploy     — the demo is its own Worker, on its own subdomain, and
 *                   deploying the real app does not touch it.
 *
 * Forgetting step 3 is how the demo drifted: it had the old code and none of
 * the [Kids Ministry] tables, so anybody shown it saw an app with no children's
 * ministry in it.
 *
 * Safe to re-run. It only ever touches seh-demo — a separate Worker with a
 * separate database holding nothing but invented people. DEMO_INSTANCE=1 is
 * set in wrangler.demo.jsonc, which is what makes texting impossible there.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CONFIG = ['--config', 'wrangler.demo.jsonc'];
const run = (args, label) => {
  process.stdout.write(`\n── ${label}\n`);
  execFileSync('npx', ['wrangler', ...args], { stdio: 'inherit' });
};

run(['d1', 'migrations', 'apply', 'seh-demo', '--remote', ...CONFIG],
    'migrating the demo database');

// The seed writes SQL to stdout rather than applying it — same as it always
// has, so it can be inspected before it goes anywhere.
process.stdout.write('\n── generating the invented congregation\n');
const sql = execFileSync('node', ['scripts/seed-demo.mjs'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const file = join(tmpdir(), 'seh-demo-seed.sql');
writeFileSync(file, sql);
process.stdout.write(`   ${sql.split('\n').length} statements → ${file}\n`);

run(['d1', 'execute', 'seh-demo', '--remote', '--file', file, ...CONFIG],
    'seeding the demo database');

// The build is the REAL app's build — one codebase, two deployments. The only
// difference between them is the config passed here.
process.stdout.write('\n── building\n');
execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });

run(['deploy', ...CONFIG], 'deploying the demo worker');

process.stdout.write('\n✓ https://demo.yourchurch.org is up to date\n\n');
