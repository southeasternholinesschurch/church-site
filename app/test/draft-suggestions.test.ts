/**
 * A draft may suggest the sermon's title and the passage it came from.
 *
 * The cleaning run has just read the whole service, so it knows what he
 * preached from; writing that at the top of the draft saves the pastor typing what
 * the transcript already says. It is a guess, so it only ever fills a field
 * that is still empty, and he types over it while he reviews.
 *
 * The block must never eat the sermon. A transcript is the thing being
 * protected here: losing its first paragraphs to a frontmatter block that was
 * never there is far worse than ignoring a malformed one, which is why a block
 * only counts when every line in it parses.
 *
 * Two implementations — the staff app bundles for Workers and cannot import
 * from site/scripts — so every case runs against both.
 *
 *   npm test
 */
import { splitDraft } from '../src/lib/site-sermons.ts';
import { splitDraft as splitMjs, draftText, quote }
  from '../../site/scripts/lib/draft-front.mjs';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/** Every case runs through both implementations, and they must agree. */
const both = (label: string, input: string, want: { suggested: Record<string, string>; text: string }) => {
  eq(`${label} (app)`, splitDraft(input), want);
  eq(`${label} (script)`, splitMjs(input), want);
};

const SERMON = '## The choice of a donkey\n\nThroughout his earthly ministry, Jesus had been careful.';

// Drafts written before any of this existed. They are plain text and must come
// back untouched — there are several of them in the archive already.
both('a draft with no block at all', `${SERMON}\n`, { suggested: {}, text: SERMON });

// The shape a run writes.
both('title and passage',
  `---\ntitle: "The Triumphal Entry"\nscripture: "Matthew 21:1-11"\n---\n\n${SERMON}\n`,
  { suggested: { title: 'The Triumphal Entry', scripture: 'Matthew 21:1-11' }, text: SERMON });

// A colon is the whole reason values are quoted, but an unquoted one still has
// to read correctly — the key ends at the FIRST colon, not the last.
both('an unquoted reference keeps its colon',
  `---\nscripture: Isaiah 57:15\n---\n\n${SERMON}\n`,
  { suggested: { scripture: 'Isaiah 57:15' }, text: SERMON });

both('one key only',
  `---\ntitle: "High Places & Humble Hearts"\n---\n\n${SERMON}\n`,
  { suggested: { title: 'High Places & Humble Hearts' }, text: SERMON });

// Narrow on purpose: this is the one place a machine-written value crosses into
// the sermon's frontmatter, and only two keys are allowed through.
both('an unexpected key is dropped, not trusted',
  `---\ntitle: "A Title"\nspeaker: "Somebody Else"\ndraft: false\n---\n\n${SERMON}\n`,
  { suggested: { title: 'A Title' }, text: SERMON });

both('an empty value is no suggestion',
  `---\ntitle: ""\nscripture: "Mark 6:3"\n---\n\n${SERMON}\n`,
  { suggested: { scripture: 'Mark 6:3' }, text: SERMON });

both('a quoted quote survives',
  `---\ntitle: "He Said \\"Come\\""\n---\n\n${SERMON}\n`,
  { suggested: { title: 'He Said "Come"' }, text: SERMON });

// THE CASE THAT MATTERS. A transcript opening with a horizontal rule must keep
// its own words rather than have them read as frontmatter and thrown away.
const RULED = `---\nAnd he said unto them, Come ye yourselves apart.\n---\n\n${SERMON}`;
both('a block that does not parse is left as text', `${RULED}\n`, { suggested: {}, text: RULED });

both('an empty block is left as text',
  '---\n\n---\n\nAnd he said.\n',
  { suggested: {}, text: '---\n\n---\n\nAnd he said.' });

// The marker still ends the transcript; the block at the top is a separate
// thing at the other end and must not disturb it.
both('the editor\'s notes are still in the text, for the publisher to cut',
  `---\ntitle: "A Title"\n---\n\n${SERMON}\n\n<!-- editor's notes -->\n- a note\n`,
  { suggested: { title: 'A Title' }, text: `${SERMON}\n\n<!-- editor's notes -->\n- a note` });

// The writer and the reader have to agree, or a run's guess never arrives.
eq('draftText round-trips', splitMjs(draftText({ title: 'The Triumphal Entry', scripture: 'Matthew 21:1-11' }, SERMON)),
  { suggested: { title: 'The Triumphal Entry', scripture: 'Matthew 21:1-11' }, text: SERMON });
eq('draftText writes no block when there is nothing to suggest',
  draftText({}, SERMON), `${SERMON}\n`);
eq('draftText round-trips a title with a colon in it',
  splitMjs(draftText({ title: 'Ephesians: A Walk Worthy' }, SERMON)).suggested,
  { title: 'Ephesians: A Walk Worthy' });
eq('quote escapes a backslash', quote('a\\b'), '"a\\\\b"');

console.log(fail === 0 ? '\nall passed' : `\n${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
