/**
 * A sermon page ends with the preaching.
 *
 * The cleaning routine writes notes for whoever reviews the draft — what the
 * ASR misheard, a scripture it corrected, a passage it could not make out — and
 * both publish paths are supposed to cut them off. Both used to treat the
 * marker as an HTML comment wrapped around the notes:
 *
 *     <!-- editor's notes -->
 *     - Mark 6:3 came through as "Joseph"; the KJV reads "Joses".
 *
 * Removing "the comment" removed the first line and published the bullets.
 * Three sermons went up with an agent's working notes on them, under the
 * pastor's name, on his church's website.
 *
 * There are two implementations — the staff app bundles for Workers and cannot
 * import from site/scripts — so every case runs against both.
 *
 * Same plain style and no node: imports as the other tests here.
 *
 *   npm test
 */
import { stripEditorNotes, hasEditorNotes } from '../src/lib/site-sermons.ts';
import { stripEditorNotes as stripMjs, hasEditorNotes as hasMjs }
  from '../../site/scripts/lib/editor-notes.mjs';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/** Every case runs through both implementations, and they must agree. */
const both = (label: string, input: string, want: string) => {
  eq(`${label} (app)`, stripEditorNotes(input), want);
  eq(`${label} (script)`, stripMjs(input), want);
};

const SERMON = 'Stand with me if you will tonight.\nThank you for your kind attention. Amen.';

// The shape the routine actually produces, and the one that got published.
both('notes beneath the marker',
  `${SERMON}\n\n<!-- editor's notes -->\n- Mark 6:3 came through as "Joseph".\n- "pecular" corrected to "peculiar".\n`,
  SERMON);

// The shape the old code assumed. Still has to work.
both('notes inside the comment',
  `${SERMON}\n\n<!-- editor's notes:\n  Mark 6:3 came through as "Joseph".\n-->\n`,
  SERMON);

both('marker with no apostrophe', `${SERMON}\n\n<!-- editors notes -->\n- a note\n`, SERMON);
both('marker capitalised', `${SERMON}\n\n<!-- Editor's Notes -->\n- a note\n`, SERMON);
both('marker singular', `${SERMON}\n\n<!-- editor notes -->\n- a note\n`, SERMON);
both('written as a heading', `${SERMON}\n\n## Editor's notes\n\n- a note\n`, SERMON);
both('written in bold', `${SERMON}\n\n**Editor's notes**\n\n- a note\n`, SERMON);

// Nothing to cut: a clean transcript must come back untouched but for trailing space.
both('no notes at all', `${SERMON}\n`, SERMON);

// The sermon's own words are never the marker. A preacher saying the phrase
// mid-sentence is not an instruction to truncate his sermon.
const INLINE = 'He said the editor\'s notes were in the margin of his Bible.\nAnd he read on.';
both('the phrase inside a sentence is left alone', INLINE, INLINE);

// Headings inside the sermon survive — only the notes marker ends it.
const WITH_HEADINGS = '## He marveled at their faith\n\nAnd he answered.\n\n## The appeal\n\nStand with me.';
both('the sermon keeps its own headings', WITH_HEADINGS, WITH_HEADINGS);

eq('hasEditorNotes agrees (app)', hasEditorNotes(`${SERMON}\n\n<!-- editor's notes -->\n- x`), true);
eq('hasEditorNotes agrees (script)', hasMjs(`${SERMON}\n\n<!-- editor's notes -->\n- x`), true);
eq('hasEditorNotes on a clean sermon (app)', hasEditorNotes(SERMON), false);
eq('hasEditorNotes on a clean sermon (script)', hasMjs(SERMON), false);

console.log(fail === 0 ? '\nall passed' : `\n${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
