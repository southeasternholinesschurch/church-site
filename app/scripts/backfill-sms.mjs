#!/usr/bin/env node
/**
 * One-time backfill for the texting feature.
 *
 *   node scripts/backfill-sms.mjs            # report only
 *   node scripts/backfill-sms.mjs --write
 *   node scripts/backfill-sms.mjs --write --remote
 *
 * Two jobs:
 *
 * 1. Normalise every phone number into phone_e164. A number that will not
 *    normalise is REPORTED, not guessed at — that person simply cannot be
 *    texted until someone fixes the number, and silently inventing a plausible
 *    one is how a message reaches a stranger.
 *
 * 2. Seed SMS consent from the Breeze import. Breeze recorded all 120 people
 *    as "Opted In", but that was for whatever tool the church used before, so
 *    it is written with source 'breeze-import' and NO date — there genuinely
 *    is not one. Anyone the pastor asks properly gets 'asked-in-person' and a real
 *    timestamp, so the two are always tellable apart.
 */
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const REMOTE = argv.includes('--remote');
const scope = REMOTE ? '--remote' : '--local';

const sql = (q) => {
  const out = execFileSync('npx',
    ['wrangler', 'd1', 'execute', 'changeme-app', scope, '--json', '--command', q],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf('[')))[0]?.results ?? [];
};
const esc = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

/** Same rule as src/lib/sms.ts — US-only, and null rather than a guess. */
function toE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  const t = String(raw).trim();
  if (/^\+[1-9]\d{7,14}$/.test(t)) return t;
  return null;
}

const people = sql(`SELECT id, first_name, last_name, phone, breeze_id, adult_child
                    FROM people WHERE archived = 0`);

const good = [], bad = [], nophone = [];
for (const p of people) {
  if (!p.phone) { nophone.push(p); continue; }
  const e = toE164(p.phone);
  (e ? good : bad).push({ ...p, e164: e });
}

// A number two people share is worth knowing about: a shared family mobile
// means one handset receives the message twice.
const seen = new Map();
for (const p of good) seen.set(p.e164, [...(seen.get(p.e164) ?? []), p]);
const dupes = [...seen.entries()].filter(([, v]) => v.length > 1);

console.log(`People (not archived): ${people.length}`);
console.log(`  with a usable number   ${good.length}`);
console.log(`  no number at all       ${nophone.length}`);
console.log(`  number will NOT parse  ${bad.length}`);
for (const p of bad) console.log(`      #${p.id} ${p.first_name} ${p.last_name} — ${JSON.stringify(p.phone)}`);
if (dupes.length) {
  console.log(`\n  numbers shared by more than one person (each handset gets the message once per person):`);
  for (const [num, ps] of dupes) console.log(`      ${num} — ${ps.map((p) => `${p.first_name} ${p.last_name}`).join(', ')}`);
}

const adultsReachable = good.filter((p) => p.adult_child === 'adult').length;
console.log(`\n  of those, adults: ${adultsReachable}`);

if (!WRITE) { console.log('\nREPORT ONLY — re-run with --write.'); process.exit(0); }

const stmts = good.map((p) => `UPDATE people SET phone_e164 = ${esc(p.e164)} WHERE id = ${p.id};`);
// Consent only for people who came from Breeze, and only if not already set —
// never overwrite a decision someone has since recorded by hand.
stmts.push(`UPDATE people
            SET sms_consent = 'opted_in', sms_consent_source = 'breeze-import'
            WHERE breeze_id IS NOT NULL AND sms_consent = 'unknown';`);

// D1 caps how much one command can carry, so send it in chunks.
for (let i = 0; i < stmts.length; i += 40) {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'changeme-app', scope, '--command',
    stmts.slice(i, i + 40).join('\n')], { stdio: ['ignore', 'ignore', 'pipe'] });
}
console.log(`\nWritten to the ${REMOTE ? 'remote' : 'local'} database.`);
