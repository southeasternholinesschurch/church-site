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
import { stripEditorNotes, hasEditorNotes, draftAlreadyPublished } from '../src/lib/site-sermons.ts';
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

/* ==== has this draft already been published? ============================= */

/**
 * The judgement behind finishing a half-completed publish.
 *
 * Publishing writes the sermon and then deletes the draft — two calls, and the
 * second can fail on its own. When it does, the sermon is live and the draft
 * survives, and the screen used to refuse every attempt to tidy up: the text it
 * objected to was the text this very draft had put there.
 *
 * So publishing now finishes the job when the page already says exactly what
 * the draft says. The danger is the other direction — deleting a draft
 * somebody still wants, which cannot be undone from the dashboard — so this is
 * an exact match after the same cut publishing makes, never a resemblance.
 */
const PREACHED = '## The choice of a donkey\n\nThroughout his earthly ministry, Jesus had been careful.';
const MARGINALIA = "<!-- editor's notes -->\n- Ephesians 4:2's \"lowliness\" came through as \"loneliness\".";

eq('the page holds exactly what the draft says',
   draftAlreadyPublished(PREACHED, PREACHED), true);

// Publishing cuts the notes, so the page will never carry them. Comparing
// without cutting would call every real half-done publish a mismatch.
eq('and still does when the draft carries editor notes',
   draftAlreadyPublished(PREACHED, `${PREACHED}\n\n${MARGINALIA}\n`), true);

eq('surrounding whitespace is not a difference',
   draftAlreadyPublished(`\n${PREACHED}\n\n`, `${PREACHED}\n`), true);

// THE ONE THAT PROTECTS SOMEBODY'S WORK. A draft that says something the page
// does not is unpublished work, whatever else is true, and must survive.
eq('a draft saying something different is NOT published',
   draftAlreadyPublished(PREACHED, `${PREACHED}\n\nAnd one more thing he said.`), false);
eq('nor is one the page merely starts with',
   draftAlreadyPublished(PREACHED, PREACHED.slice(0, 40)), false);

// An empty page is never a match, or the first publish would delete its own
// source before it had written anything.
eq('an empty page is never a match', draftAlreadyPublished('', PREACHED), false);
eq('nor is a page of whitespace', draftAlreadyPublished('   \n\n ', PREACHED), false);

console.log(fail === 0 ? '\nall passed' : `\n${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
