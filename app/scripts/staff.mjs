#!/usr/bin/env node
/**
 * Grant, list or revoke staff access.
 *
 *   node scripts/staff.mjs add someone@gmail.com --admin      # local db
 *   node scripts/staff.mjs add someone@gmail.com --kids        # [Kids Ministry] only
 *   node scripts/staff.mjs add someone@gmail.com --kids-director
 *   node scripts/staff.mjs add someone@gmail.com --remote
 *   node scripts/staff.mjs list
 *   node scripts/staff.mjs revoke someone@gmail.com --remote
 *
 * Deliberately a script and not a seed file: staff addresses are personal data
 * and have no business sitting in the repository. Nobody self-registers — a
 * Google sign-in proves identity, this list decides access.
 */
import { execFileSync } from 'node:child_process';

const [cmd, arg] = process.argv.slice(2);
const flags = new Set(process.argv.slice(2));
const scope = flags.has('--remote') ? '--remote' : '--local';
/*
 * Roles, from src/lib/permissions.ts. Named flags rather than a --role= value
 * so a typo produces "unknown flag" here instead of a row the permission gate
 * does not recognise.
 *
 * No flag still means `editor`, which is what it has always meant — changing
 * that default would silently downgrade anyone re-added by an existing habit.
 */
const ROLE_FLAGS = ['admin', 'editor', 'kids-director', 'kids'];
const named = ROLE_FLAGS.filter((r) => flags.has(`--${r}`));
if (named.length > 1) {
  console.error(`Pick one role, not ${named.length}: ${named.join(', ')}`);
  process.exit(1);
}
const role = named[0] ?? 'editor';

const sql = (q) => {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'seh-app', scope, '--json', '--command', q],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out.slice(out.indexOf('[')));
};
const esc = (s) => `'${String(s).replace(/'/g, "''")}'`;

if (cmd === 'add') {
  if (!arg || !arg.includes('@')) { console.error('Usage: staff.mjs add <email> [--admin] [--remote]'); process.exit(1); }
  const email = arg.toLowerCase();
  sql(`INSERT INTO staff (email, role, active, created_at)
       VALUES (${esc(email)}, ${esc(role)}, 1, ${esc(new Date().toISOString())})
       ON CONFLICT(email) DO UPDATE SET active = 1, role = ${esc(role)}`);
  console.log(`${email} can now sign in as ${role} (${scope.replace('--', '')}).`);
} else if (cmd === 'revoke') {
  if (!arg) { console.error('Usage: staff.mjs revoke <email> [--remote]'); process.exit(1); }
  // Deactivate rather than delete: readSession re-checks `active` on EVERY
  // request, so this locks them out immediately, and the record stays as a
  // note of who once had access.
  sql(`UPDATE staff SET active = 0 WHERE email = ${esc(arg.toLowerCase())}`);
  sql(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email = ${esc(arg.toLowerCase())})`);
  console.log(`${arg} revoked, and any signed-in session ended.`);
} else if (cmd === 'list') {
  const r = sql('SELECT email, role, active, last_login_at FROM staff ORDER BY email');
  const rows = r[0]?.results ?? [];
  if (!rows.length) console.log('No staff yet. Add one with: node scripts/staff.mjs add <email> --admin');
  for (const s of rows) {
    console.log(`  ${s.active ? '✓' : '✗'} ${s.email.padEnd(34)} ${s.role.padEnd(14)} ${s.last_login_at ?? 'never signed in'}`);
  }
} else {
  console.error('Usage: staff.mjs <add|revoke|list> [email] [--admin|--editor|--kids-director|--kids] [--remote]');
  process.exit(1);
}
