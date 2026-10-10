#!/usr/bin/env node
/**
 * Import the Fairhaven Kids van list (a spreadsheet, saved as CSV) as children.
 *
 * Into Fairhaven Kids' OWN list (`kids`), never the church's `people` — see the note on
 * `kids` in src/db/schema.ts.
 *
 *   node scripts/import-van-list.mjs <older.csv> [<newer.csv> ...]            # dry run
 *   node scripts/import-van-list.mjs <older.csv> <newer.csv> --write          # local DB
 *   node scripts/import-van-list.mjs <older.csv> <newer.csv> --write --remote # live DB
 *
 * Columns, by position (the header text changes every week — one of them is a
 * date): 0 Name · 1 Address · 2 coming? · 7 Phone · 8 Parents.
 *
 * Several files are the same list at different times. Later files win, so pass
 * them oldest first.
 *
 * THE FILE NEVER ENTERS THE REPOSITORY. Like import-breeze.mjs, the SQL goes to
 * a temp file outside the project that is deleted whether or not it succeeds.
 *
 * WHAT THE LIST DOES NOT SAY, AND WHAT IS DONE ABOUT IT
 *   - Last names are mostly missing. Children get the placeholder last name
 *     below so they can be found and fixed; a full name is split when present.
 *   - Class and route are left blank. The list covers every route.
 *   - A child with no contact gets a sibling's (same address). Noted on the child.
 *   - Guardians are marked opted-in, source 'verbal-at-intake': the director
 *     confirmed the families agreed to be called and texted.
 *   - The "coming?" column is attendance, not registration, and is not imported.
 *
 * RE-RUNNING IS SAFE. A child is matched on first name + last name + street and
 * an existing one is left untouched; so is an existing guardian.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PLACEHOLDER_LAST = '(unknown)';
const PLACEHOLDER_FIRST = 'Unnamed child';

const argv = process.argv.slice(2);
const files = argv.filter((a) => !a.startsWith('--'));
const WRITE = argv.includes('--write');
const REMOTE = argv.includes('--remote');
if (!files.length) {
  console.error('Usage: import-van-list.mjs <older.csv> [<newer.csv> ...] [--write] [--remote]');
  process.exit(1);
}

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

function toE164(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** The sheet's ditto mark. */
const isDitto = (s) => /^["”“]+$/.test(clean(s));
const looksLikePhone = (s) => /\d{3}\D*\d{3}\D*\d{4}/.test(s);

/** "Kaylee (7)" → age 7. "Tershanti (Shanti)" keeps its nickname. */
function parseName(raw) {
  let s = clean(raw);
  let age = null;
  const m = /\(\s*(\d{1,2})\s*\)/.exec(s);
  if (m) { age = Number(m[1]); s = clean(s.replace(m[0], ' ')); }
  const parts = s.split(' ').filter(Boolean);
  // A nickname in brackets is part of the first name, not a surname.
  const nick = /\(.*\)$/.test(s);
  if (!s) return { first: null, last: null, age };
  if (parts.length >= 2 && !nick) {
    return { first: parts[0], last: parts.slice(1).join(' '), age, fullName: true };
  }
  return { first: s, last: null, age };
}

/** Street key for matching: house number + first street word, no directions
 *  or suffixes, so "2922E Tabor" and "2922 E Tabor St" are one address. */
function addrKey(a) {
  const s = clean(a).toLowerCase().replace(/[.,#]/g, ' ').replace(/(\d)([a-z])/g, '$1 $2');
  const w = s.split(' ').filter((x) => x && !['e', 'w', 'n', 's', 'st', 'street', 'ave', 'avenue', 'ct', 'rd', 'apt'].includes(x));
  return w.slice(0, 2).join(' ');
}
const nameKey = (first) => clean(first).toLowerCase().replace(/\s*\(.*?\)\s*/g, '');

/* ---- read every file into one ordered list of observations ---- */
const flags = { notes: [], unreadable: [], dropped: [] };
const kids = new Map();       // matchKey → child
const order = [];

files.forEach((file, fileIdx) => {
  const rows = parseCsv(fs.readFileSync(file, 'utf8')).slice(1);
  let prev = { phone: '', parent: '' };
  const seenThisFile = [];
  for (const r of rows) {
    const rawName = clean(r[0]);
    const address = clean(r[1]);
    let phoneCell = clean(r[7]);
    let parentCell = clean(r[8]);
    if (isDitto(phoneCell)) phoneCell = prev.phone;
    if (isDitto(parentCell)) parentCell = prev.parent;
    if (!rawName && !address) {
      if (parentCell) flags.dropped.push(`${path.basename(file)}: "${parentCell}" with no child or address`);
      continue;
    }
    prev = { phone: phoneCell, parent: parentCell };

    // Phone and Parents are used interchangeably — sort cells by what they hold.
    let phone = null, guardian = null; const extra = [];
    for (const cell of [phoneCell, parentCell]) {
      if (!cell) continue;
      if (looksLikePhone(cell)) { if (!phone) phone = cell; }
      else if (/code|gate|^#?\d{3,5}$/i.test(cell)) extra.push(cell);
      else if (!guardian) guardian = cell;
    }
    if (extra.length) flags.notes.push(`${rawName || address}: "${extra.join(' ')}" kept in the child's notes`);
    if (guardian && /new number/i.test(guardian)) {
      flags.notes.push(`"${guardian}" → guardian "${guardian.replace(/\s*new number\s*/i, '').trim()}"`);
      guardian = guardian.replace(/\s*new number\s*/i, '').trim();
    }

    const nm = parseName(rawName);
    const obs = {
      first: nm.first || PLACEHOLDER_FIRST, last: nm.last, hadName: !!nm.first, age: nm.age,
      address: address || null, phone, guardian, extra, fileIdx,
    };
    const base = `${nameKey(obs.first)}|${addrKey(address)}`;
    // Two UNNAMED children at one house are two children; a repeated NAME at
    // one address is the same child listed twice.
    const dup = nm.first ? 0 : seenThisFile.filter((k) => k.base === base).length;
    const key = `${base}|${dup}`;
    seenThisFile.push({ base });
    obs.key = key; obs.base = base;
    if (kids.has(key)) {
      const k = kids.get(key);
      Object.assign(k, Object.fromEntries(Object.entries(obs).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length))));
    } else {
      kids.set(key, { ...obs, matchedBy: 'name+address', firstSeen: fileIdx });
      order.push(key);
    }
  }
});

/* ---- second pass: same first name, address changed between files ---- */
if (files.length > 1) {
  const byFirst = new Map();
  for (const k of order) {
    const c = kids.get(k);
    if (!c.hadName) continue;
    const f = nameKey(c.first);
    byFirst.set(f, [...(byFirst.get(f) ?? []), c]);
  }
  for (const [, group] of byFirst) {
    const olderOnly = group.filter((c) => c.fileIdx === 0 && c.firstSeen === 0);
    const newerOnly = group.filter((c) => c.firstSeen > 0);
    // Only when it is one-to-one; "Paisley" three times over is not guessable.
    if (olderOnly.length === 1 && newerOnly.length === 1 && olderOnly[0].address !== newerOnly[0].address) {
      const [o, n] = [olderOnly[0], newerOnly[0]];
      flags.notes.push(`${o.first}: address changed ${o.address} → ${n.address}; treated as one child (newer address kept)`);
      kids.delete(o.key); order.splice(order.indexOf(o.key), 1);
      for (const f of ['phone', 'guardian', 'last']) if (!n[f] && o[f]) n[f] = o[f];
    }
  }
}

/* ---- third pass: an unnamed row that a later file names ---- */
if (files.length > 1) {
  const addrs = new Set(order.map((k) => kids.get(k).base.split('|')[1]).filter(Boolean));
  for (const a of addrs) {
    const unnamed = order.map((k) => kids.get(k)).filter((c) => !c.hadName && c.firstSeen === 0 && addrKey(c.address) === a);
    const named = order.map((k) => kids.get(k)).filter((c) => c.hadName && c.firstSeen > 0 && addrKey(c.address) === a);
    if (unnamed.length && unnamed.length === named.length) {
      for (const u of unnamed) {
        flags.notes.push(`unnamed child at ${u.address} matched to a child named later at the same address`);
        kids.delete(u.key); order.splice(order.indexOf(u.key), 1);
      }
    }
  }
}

const children = order.map((k) => kids.get(k));

/* ---- shape the records ---- */
const now = new Date().toISOString();
// Unnamed children at one house need distinct names or they are one person to
// the re-run guard: "Unnamed child 1", "Unnamed child 2".
const unnamedSeen = new Map();
for (const c of children.filter((x) => !x.hadName)) {
  const k = addrKey(c.address);
  const total = children.filter((x) => !x.hadName && addrKey(x.address) === k).length;
  const i = (unnamedSeen.get(k) ?? 0) + 1; unnamedSeen.set(k, i);
  if (total > 1) c.first = `${PLACEHOLDER_FIRST} ${i}`;
}
for (const c of children) {
  c.lastName = c.last || PLACEHOLDER_LAST;
  c.street = c.address && !/^\d{1,5}$/.test(c.address) ? c.address : (c.address ? `${c.address} (house number only)` : null);
  const bits = [];
  if (c.age) bits.push(`Age ${c.age} on the Fall 2026 van list`);
  if (c.extra?.length) bits.push(c.extra.join(' '));
  if (!c.hadName) bits.push('Name not on the van list');
  c.notes = bits.join('. ') || null;
  c.guardianName = c.guardian || (c.phone ? 'Parent/guardian' : null);
}

/* ---- the dry-run report ---- */
/* A child with no contact takes their siblings' — same address, one household.
 * Done on the merged list, and only from children who HAVE a contact; where two
 * different contacts share an address, the child is left alone rather than
 * guessed. The copy is noted on the child so nobody mistakes it for a number
 * the family gave for them. */
let inherited = 0, ambiguous = 0;
for (const c of children) {
  if (c.guardianName || !c.address) continue;
  const k = addrKey(c.address);
  const sibs = children.filter((o) => o !== c && o.guardianName && addrKey(o.address) === k);
  const distinct = new Set(sibs.map((o) => `${o.guardianName}|${o.phone ?? ''}`));
  if (distinct.size === 1) {
    c.guardianName = sibs[0].guardianName; c.phone = sibs[0].phone; c.inherited = true;
    c.notes = [c.notes, 'Contact copied from a sibling at the same address'].filter(Boolean).join('. ');
    inherited++;
  } else if (distinct.size > 1) ambiguous++;
}
const n = children.length;
const withG = children.filter((c) => c.guardianName);
console.log(`Read ${files.length} file(s) → ${n} child(ren) after merging duplicates.\n`);
console.log(`Names:    full name ${children.filter((c) => c.last).length} · first name only ${children.filter((c) => !c.last && c.hadName).length} · no name ${children.filter((c) => !c.hadName).length}`);
console.log(`          (first-name-only get last name "${PLACEHOLDER_LAST}", no-name get "${PLACEHOLDER_FIRST}")`);
console.log(`Address:  ${children.filter((c) => c.address).length}/${n} · house-number-only ${children.filter((c) => c.address && /^\d{1,5}$/.test(c.address)).length}`);
console.log(`Guardian (after copying siblings): ${withG.length}/${n} with a name or number · ${children.filter((c) => c.phone && toE164(c.phone)).length} with a textable number`);
console.log(`          ${n - withG.length} child(ren) have NO contact at all (nobody to call)`);
console.log(`          ${inherited} copied from a sibling at the same address${ambiguous ? ` · ${ambiguous} left alone (siblings disagree)` : ''}`);
const badPhone = children.filter((c) => c.phone && !toE164(c.phone));
if (badPhone.length) console.log(`          not a valid US number: ${badPhone.map((c) => `${c.first} "${c.phone}"`).join(', ')}`);
if (flags.notes.length) console.log(`\nJudgement calls made:\n${flags.notes.map((s) => `  - ${s}`).join('\n')}`);
if (flags.dropped.length) console.log(`\nIgnored:\n${flags.dropped.map((s) => `  - ${s}`).join('\n')}`);
const firsts = new Map();
for (const c of children) if (c.hadName) firsts.set(nameKey(c.first), [...(firsts.get(nameKey(c.first)) ?? []), c]);
const same = [...firsts.values()].filter((g) => g.length > 1);
if (same.length) console.log(`\nSame first name, different address — imported as separate children, worth a look:\n${same.map((g) => `  - ${g[0].first}: ${g.map((c) => c.address ?? '(no address)').join(' | ')}`).join('\n')}`);

console.log('\nPreview (first 12):');
for (const c of children.slice(0, 12)) {
  console.log(`  ${c.first} ${c.lastName} · ${c.street ?? 'no address'} · ${c.guardianName ?? '—'} ${c.phone ?? ''}`);
}

if (!WRITE) { console.log('\nDRY RUN — nothing written. Re-run with --write.'); process.exit(0); }

/* ---- SQL: every statement skips what is already there ---- */
const esc = (v) => (v === null || v === undefined || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const who = (c) => `first_name = ${esc(c.first)} AND last_name = ${esc(c.lastName)} AND COALESCE(address_street,'') = ${esc(c.street ?? '').replace(/^NULL$/, "''")}`;
const lines = [];
for (const c of children) {
  lines.push(`INSERT INTO kids (first_name, last_name, address_street, notes, created_at, updated_at)
SELECT ${esc(c.first)}, ${esc(c.lastName)}, ${esc(c.street)}, ${esc(c.notes)}, ${esc(now)}, ${esc(now)}
WHERE NOT EXISTS (SELECT 1 FROM kids WHERE ${who(c)});`);
  if (c.guardianName) {
    lines.push(`INSERT INTO kid_guardians (kid_id, name, relationship, phone, phone_e164, is_primary, sms_consent, sms_consent_source, sms_consent_at, created_at, updated_at)
SELECT id, ${esc(c.guardianName)}, ${esc(/^(mom|dad)$/i.test(c.guardianName) ? c.guardianName : null)}, ${esc(c.phone)}, ${esc(toE164(c.phone))}, 1,
  ${c.phone && toE164(c.phone) ? "'opted_in', 'verbal-at-intake'" : "'unknown', NULL"}, ${c.phone && toE164(c.phone) ? esc(now) : 'NULL'}, ${esc(now)}, ${esc(now)}
FROM kids WHERE ${who(c)}
  AND NOT EXISTS (SELECT 1 FROM kid_guardians WHERE kid_id = kids.id);`);
  }
}

const tmp = path.join(os.tmpdir(), `van-list-import-${Date.now()}.sql`);
fs.writeFileSync(tmp, lines.join('\n'), { mode: 0o600 });
if (process.env.VAN_SQL_ONLY) { console.log(`SQL at ${tmp} (VAN_SQL_ONLY: not executed, not deleted)`); process.exit(0); }
try {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'changeme-app', REMOTE ? '--remote' : '--local', '--file', tmp, '--yes'], { stdio: 'inherit' });
  console.log(`\nImported ${n} child(ren) into the ${REMOTE ? 'remote' : 'local'} database.`);
} finally {
  fs.rmSync(tmp, { force: true });
  console.log('Temporary SQL file deleted.');
}
