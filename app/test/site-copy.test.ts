/**
 * Every page-text file is reachable and properly named in the dashboard.
 *
 * The dashboard lists whatever .yaml files exist in the site's copy folder and
 * looks each one up in PAGE_LABELS for its name. A file with no label still
 * appears — labelled with its own filename, so "thank-you" or "im-new" shows
 * up in a list of proper page names. Not broken, just shabby, and shabby in a
 * way nobody notices until someone asks what "im-new" is.
 *
 * The other direction matters more: a label for a page whose file was renamed
 * or deleted is dead config that quietly does nothing.
 *
 * Same plain style and no node: imports as the other tests here.
 *
 *   npm test
 */
import { readdirSync, readFileSync } from 'node:fs';
import { PAGE_LABELS, copyFields } from '../src/lib/site-copy.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

const files = readdirSync(new URL('../../site/src/content/copy', import.meta.url))
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => f.replace(/\.yaml$/, ''))
  .sort();

eq('there are copy files to check at all', files.length > 0, true);

eq('every copy file has a dashboard name',
  files.filter((page) => !PAGE_LABELS[page]), []);

eq('every dashboard name has a copy file',
  Object.keys(PAGE_LABELS).filter((page) => !files.includes(page)), []);

// A label that is just the filename back again is the bug this file exists to
// stop — it means somebody added the key to satisfy the check above without
// naming the page.
eq('no label is just the slug',
  files.filter((page) => PAGE_LABELS[page] === page), []);

// ---------------------------------------------------------------------------
// What the dashboard actually draws.
//
// People find a sentence by remembering where it sits on the page, so the
// grouping is the feature. These check the real files rather than a fixture:
// a group or label that comes out wrong comes out wrong for him.

const dir = new URL('../../site/src/content/copy', import.meta.url);
const fieldsFor = (page: string) =>
  copyFields(readFileSync(new URL(`${dir.pathname}/${page}.yaml`, 'file://'), 'utf8'));

const all = files.flatMap((page) => fieldsFor(page).map((f) => ({ page, ...f })));

eq('every page yields at least one field',
  files.filter((page) => fieldsFor(page).length === 0), []);

eq('no field is missing a group or a label',
  all.filter((f) => !f.group || !f.label).map((f) => `${f.page}:${f.path}`), []);

// A label is made from the key, so a key like `body1` reads as "Body1". That
// is fine; a label that is still camelCase is not — it means describe() did
// not split it, and the dashboard shows a variable name.
eq('no label is left in camelCase',
  all.filter((f) => /[a-z][A-Z]/.test(f.label)).map((f) => `${f.page}:${f.label}`), []);

eq('no group is left in camelCase',
  all.filter((f) => /[a-z][A-Z]/.test(f.group)).map((f) => `${f.page}:${f.group}`), []);

// Two fields sharing a group AND a label are indistinguishable on screen.
const dupes = all.filter((f, i, xs) =>
  xs.some((o, j) => j !== i && o.page === f.page && o.group === f.group && o.label === f.label));
eq('no two fields in a group share a name',
  [...new Set(dupes.map((f) => `${f.page}: ${f.group} / ${f.label}`))], []);

// Groups are built from the file's own structure, so they should read as the
// names of sections on the page — "Hero", "Expect · Welcome" — and each should
// appear once, as a contiguous run. A group that comes back twice in two places
// means the file lists the same section's keys in two separate spots, which
// splits them into two blocks in the dashboard.
// A section MAY appear twice when its own sub-sections sit between the two —
// the giving page opens "Ways to give", lists Online, In person and Other, then
// closes with a note that belongs to Ways again. On screen that reads as one
// section containing three, which is right. What this rejects is the same
// section turning up twice with something unrelated in between.
for (const page of files) {
  const groups = fieldsFor(page).map((f) => f.group);
  const runs = groups.filter((g, i) => g !== groups[i - 1]);
  const split = runs.filter((g, i) => {
    const first = runs.indexOf(g);
    if (first === i) return false;
    return !runs.slice(first + 1, i).every((o) => o.startsWith(`${g} · `));
  });
  eq(`${page}: each section appears in one place`, split, []);
}

console.log(`\n${all.length} fields across ${files.length} pages`);

console.log(fail === 0 ? '\nall passed' : `\n${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
