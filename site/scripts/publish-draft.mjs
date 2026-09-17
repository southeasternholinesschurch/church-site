#!/usr/bin/env node
/**
 * Publishes a cleaned transcript by moving it into the sermon's markdown body.
 *
 *   node scripts/publish-draft.mjs 2026-09-06-sunday-morning
 *   node scripts/publish-draft.mjs --list
 *
 * The sermon page already renders whatever is in that body, so this is the
 * whole of "publish". Until it runs, a draft sits in transcripts/drafts/ where
 * nothing on the site reads it — which is the review gate, and the reason the
 * routine never writes to the sermon file itself.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripEditorNotes } from './lib/editor-notes.mjs';
import { splitDraft, SUGGESTED_KEYS, quote } from './lib/draft-front.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DRAFTS = path.join(HERE, '..', 'transcripts', 'drafts');
const SERMONS = path.join(HERE, '..', 'src', 'content', 'sermons');

const slug = process.argv[2];
const listing = !slug || slug === '--list';

const drafts = fs.existsSync(DRAFTS)
  ? fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.md') && f !== 'README.md')
  : [];

if (listing) {
  if (!drafts.length) { console.log('No drafts awaiting review.'); process.exit(0); }
  console.log(`${drafts.length} draft(s) awaiting review:\n`);
  for (const f of drafts) {
    const { suggested, text } = splitDraft(fs.readFileSync(path.join(DRAFTS, f), 'utf8'));
    const words = text.split(/\s+/).filter(Boolean).length;
    const guess = [suggested.title, suggested.scripture].filter(Boolean).join(' — ');
    console.log(`  ${f.replace(/\.md$/, '')}   ${words.toLocaleString()} words${guess ? `   ${guess}` : ''}`);
  }
  console.log('\nPublish one with:  node scripts/publish-draft.mjs <slug>');
  process.exit(0);
}

/**
 * Add the draft's suggestions to a sermon's frontmatter block.
 *
 * `block` is the whole `---\n…\n---\n`. Only keys that are absent or empty are
 * written, and new ones go at the end where the CMS also appends them, so the
 * diff is one line per field rather than a reordered block.
 */
function applySuggestions(block, suggested) {
  const m = /^---\n([\s\S]*?)\n---\n$/.exec(block);
  if (!m) return { front: block, filled: [] };

  const lines = m[1].split('\n');
  const filled = [];
  for (const key of SUGGESTED_KEYS) {
    const value = String(suggested?.[key] ?? '').trim();
    if (!value) continue;
    const at = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (at >= 0 && lines[at].slice(key.length + 1).trim()) continue;  // already answered
    if (at >= 0) lines[at] = `${key}: ${quote(value)}`;
    else lines.push(`${key}: ${quote(value)}`);
    filled.push([key, value]);
  }
  return { front: `---\n${lines.join('\n')}\n---\n`, filled };
}

const draftPath = path.join(DRAFTS, `${slug}.md`);
const sermonPath = path.join(SERMONS, `${slug}.md`);

if (!fs.existsSync(draftPath)) { console.error(`No draft for ${slug}.`); process.exit(1); }
if (!fs.existsSync(sermonPath)) { console.error(`No sermon file for ${slug}.`); process.exit(1); }

const { suggested, text: draft } = splitDraft(fs.readFileSync(draftPath, 'utf8'));
const sermon = fs.readFileSync(sermonPath, 'utf8');

const m = /^(---\n[\s\S]*?\n---\n)([\s\S]*)$/.exec(sermon);
if (!m) { console.error(`${slug}.md has no frontmatter block to preserve.`); process.exit(1); }
const [, frontmatter, body] = m;

if (body.trim()) {
  console.error(`${slug} already has body text. Refusing to overwrite it.`);
  console.error('Delete or merge it by hand first — this is somebody\'s work either way.');
  process.exit(1);
}

// Editor's notes are for the reviewer, not for the congregation. The marker
// ends the transcript — see lib/editor-notes.mjs for why that is a cut and
// not a deletion.
const cleaned = stripEditorNotes(draft).trim();

/*
 * A draft may suggest the sermon's title and the passage it was preached
 * from — see lib/draft-front.mjs. They fill a field the sermon has left empty
 * and never touch one that already has an answer, because a guess made by
 * reading the transcript is worth less than anything already written down.
 */
const { front, filled } = applySuggestions(frontmatter, suggested);

fs.writeFileSync(sermonPath, `${front}\n${cleaned}\n`);
fs.unlinkSync(draftPath);

console.log(`Published ${slug} — ${cleaned.split(/\s+/).length.toLocaleString()} words moved into the sermon page.`);
for (const [key, value] of filled) console.log(`  filled in ${key}: ${value}   (a guess — check it)`);
console.log('Commit and push, and it is live at the next build.');
