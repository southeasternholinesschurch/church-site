#!/usr/bin/env node
/**
 * Import a Breeze people export into the app's database.
 *
 *   node scripts/import-breeze.mjs <file.csv>              # dry run, local
 *   node scripts/import-breeze.mjs <file.csv> --write
 *   node scripts/import-breeze.mjs <file.csv> --write --remote
 *   node scripts/import-breeze.mjs <file.csv> --write --refresh
 *
 * THE FILE NEVER ENTERS THE REPOSITORY. It is read from wherever it sits on
 * your machine, turned into SQL in a temporary file outside the project, and
 * that file is deleted whether the import succeeds or fails. Nothing here
 * writes member data anywhere git can see it.
 *
 * WHAT IS DELIBERATELY NOT IMPORTED. Breeze carries columns the brief says the
 * church does not track — Status (member/attender), Marital Status, Gender,
 * School, Employer, Campus. They are dropped, because a column that exists
 * eventually gets filled, and §10 is explicit that no membership status is
 * kept. `Grade` is dropped too: it is the literal string "False" on all 120
 * rows, an export artefact rather than data. SMS Enrolment is dropped because
 * texting consent lives in the texting tool, not here.
 *
 * RE-RUNNING IS SAFE. Matching is on Breeze ID. An existing person is left
 * alone unless --refresh is passed, and even then only contact details are
 * updated: adult/child and the directory toggle are staff decisions made from
 * consent gathered in person, and an import must never quietly undo them.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
const WRITE = argv.includes('--write');
const REMOTE = argv.includes('--remote');
const REFRESH = argv.includes('--refresh');

if (!file) {
  console.error('Usage: import-breeze.mjs <export.csv> [--write] [--remote] [--refresh]');
  process.exit(1);
}
if (!fs.existsSync(file)) { console.error(`No such file: ${file}`); process.exit(1); }

/** Minimal RFC4180 parser — quoted fields, embedded commas, doubled quotes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const raw = parseCsv(fs.readFileSync(file, 'utf8')).filter((r) => r.some((v) => v !== ''));
const header = raw[0].map((h) => h.trim());
const records = raw.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));

const col = (r, ...names) => { for (const n of names) if (r[n]) return r[n]; return ''; };

/** Breeze writes MM/DD/YYYY; the database stores YYYY-MM-DD so dates sort. */
function toIsoDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s || '');
  if (!m) return null;
  const [, mo, d, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Adult/child, in order of how much the signal can be trusted. Family Role is
 * a statement; age is a derivation; everything else is a guess, and a guess is
 * what `unknown` exists to avoid making.
 */
function classify(r) {
  const role = col(r, 'Family Role').toLowerCase();
  if (role) {
    if (role.includes('child')) return { v: 'child', why: 'family role' };
    if (role.includes('head') || role.includes('spouse') || role.includes('adult'))
      return { v: 'adult', why: 'family role' };
  }
  const age = Number(col(r, 'Age'));
  if (Number.isFinite(age) && age > 0) return { v: age >= 18 ? 'adult' : 'child', why: 'age' };
  const bd = toIsoDate(col(r, 'Birthdate'));
  if (bd) {
    const years = (Date.now() - Date.parse(bd)) / 31557600000;
    if (years > 0 && years < 120) return { v: years >= 18 ? 'adult' : 'child', why: 'birthdate' };
  }
  return { v: 'unknown', why: 'no signal' };
}

const now = new Date().toISOString();
const esc = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const people = [];
const stats = { adult: 0, child: 0, unknown: 0, why: {}, email: 0, phone: 0, address: 0, noName: 0 };

for (const r of records) {
  const first = col(r, 'First Name');
  const last = col(r, 'Last Name');
  if (!first && !last) { stats.noName++; continue; }

  const cls = classify(r);
  stats[cls.v]++;
  stats.why[cls.why] = (stats.why[cls.why] ?? 0) + 1;

  const email = col(r, 'Email').toLowerCase() || null;
  const phone = col(r, 'Mobile', 'Home', 'Work') || null;
  const street = col(r, 'Street Address') || null;
  if (email) stats.email++;
  if (phone) stats.phone++;
  if (street) stats.address++;

  people.push({
    breezeId: Number(col(r, 'Breeze ID')) || null,
    firstName: first || last, lastName: last || first,
    phone, email,
    street, city: col(r, 'City') || null, state: col(r, 'State') || null,
    zip: col(r, 'Zip') || null,
    birthday: toIsoDate(col(r, 'Birthdate')),
    familyId: Number(col(r, 'Family')) || null,
    addedOn: toIsoDate(col(r, 'Added Date')),
    adultChild: cls.v,
  });
}

console.log(`Read ${records.length} row(s) from ${path.basename(file)} → ${people.length} person record(s).`);
if (stats.noName) console.log(`  skipped ${stats.noName} row(s) with no name at all`);
console.log(`\nAdult / child:`);
console.log(`  adult    ${stats.adult}`);
console.log(`  child    ${stats.child}`);
console.log(`  unknown  ${stats.unknown}   ← no age, birthday or family role to derive it from`);
console.log(`  derived from: ${Object.entries(stats.why).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log(`\nContact details present:`);
console.log(`  email    ${stats.email}/${people.length}   ← the directory needs this to send an invite`);
console.log(`  phone    ${stats.phone}/${people.length}`);
console.log(`  address  ${stats.address}/${people.length}`);

if (!WRITE) {
  console.log(`\nDRY RUN — nothing written. Re-run with --write.`);
  process.exit(0);
}

const lines = people.map((p) => {
  const cols = `(breeze_id, first_name, last_name, phone, email, address_street, address_city,
    address_state, address_zip, birthday, family_id, added_on, adult_child, created_at, updated_at)`;
  const vals = `(${[p.breezeId ?? 'NULL', esc(p.firstName), esc(p.lastName), esc(p.phone), esc(p.email),
    esc(p.street), esc(p.city), esc(p.state), esc(p.zip), esc(p.birthday),
    p.familyId ?? 'NULL', esc(p.addedOn), esc(p.adultChild), esc(now), esc(now)].join(', ')})`;
  // Contact details refresh; adult_child and include_in_directory never do —
  // those are staff decisions taken from consent gathered in person, and an
  // import quietly reverting them is exactly the bug that must not exist.
  const onConflict = REFRESH
    ? ` ON CONFLICT(breeze_id) DO UPDATE SET
        first_name=excluded.first_name, last_name=excluded.last_name,
        phone=excluded.phone, email=excluded.email,
        address_street=excluded.address_street, address_city=excluded.address_city,
        address_state=excluded.address_state, address_zip=excluded.address_zip,
        birthday=COALESCE(excluded.birthday, people.birthday),
        family_id=excluded.family_id, updated_at=${esc(now)}`
    : ' ON CONFLICT(breeze_id) DO NOTHING';
  return `INSERT INTO people ${cols} VALUES ${vals}${onConflict};`;
});

// Outside the project, so a stray `git add -A` cannot reach it.
const tmp = path.join(os.tmpdir(), `breeze-import-${Date.now()}.sql`);
fs.writeFileSync(tmp, lines.join('\n'), { mode: 0o600 });
try {
  const args = ['wrangler', 'd1', 'execute', 'changeme-app', REMOTE ? '--remote' : '--local', '--file', tmp, '--yes'];
  execFileSync('npx', args, { stdio: 'inherit' });
  console.log(`\nImported into the ${REMOTE ? 'remote' : 'local'} database.`);
} finally {
  fs.rmSync(tmp, { force: true });   // runs even if the import throws
  console.log('Temporary SQL file deleted.');
}
