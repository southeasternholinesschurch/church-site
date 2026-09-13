/**
 * A published sermon ends with the preaching.
 *
 * The cleaning routine writes notes for whoever reviews the draft, under a
 * marker the publisher is supposed to cut at. It did not cut deep enough: the
 * marker line went and the notes beneath it were published. Three sermons
 * carried an agent's working notes — "corrected to match scripture", "worth a
 * listen to confirm" — on the church's website, under the pastor's name.
 *
 * editor-notes.test.ts covers the cutting. This covers the RESULT, and it
 * deliberately does not look for the marker: the marker is exactly what was
 * missing from those three pages. It looks for what a person would have seen —
 * a sermon that ends in a bulleted list of notes about itself.
 *
 * Every cleaned transcript ends the way the service ended, with the appeal and
 * the closing prayer. None ends in a list.
 *
 *   npm test
 */
import { readdirSync, readFileSync } from 'node:fs';
import { hasEditorNotes } from '../src/lib/site-sermons.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

const DIR = new URL('../../site/src/content/sermons', import.meta.url);

/** The body of a sermon file, or '' when the page has no transcript yet. */
function bodyOf(text: string): string {
  const m = /^---\n[\s\S]*?\n---\n([\s\S]*)$/.exec(text);
  return (m ? m[1] : '').trim();
}

/** Does this text finish with a bulleted list? */
export function endsInAList(body: string): boolean {
  const blocks = body.split(/\n\s*\n/).filter((b) => b.trim());
  const last = blocks[blocks.length - 1] ?? '';
  return /^[ \t]*[-*+][ \t]+\S/.test(last);
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.md'));
const published = files
  .map((f) => ({ slug: f.replace(/\.md$/, ''), body: bodyOf(readFileSync(new URL(`${DIR.pathname}/${f}`, 'file://'), 'utf8')) }))
  .filter((s) => s.body);

// This template ships with an empty archive, so there may be nothing to check
// yet. That is a normal state, not a failure — the checks below start guarding
// the moment the first transcript is published.
if (published.length === 0) console.log('ok   no sermons published yet, nothing to check');

eq('no sermon ends in a list of notes about itself',
  published.filter((s) => endsInAList(s.body)).map((s) => s.slug), []);

eq('no sermon carries an editor-notes marker',
  published.filter((s) => hasEditorNotes(s.body)).map((s) => s.slug), []);

// The check has to be able to fail, and on the real thing. This is the ending a
// sermon actually had on the live site of the church this was built for.
const WAS_PUBLISHED = `Thank you for your kind attention. Amen.


- The transition into the Luke 7 passage was garbled in the recording: he
  first said "Matthew chapter 9," caught himself, and corrected to "Luke
  chapter 7."
- Mark 6:3 in the recording came through as "Joseph" and "Judah" — the KJV
  text of that verse reads "Joses" and "Juda." Corrected to match scripture.`;
eq('the check catches the ending that actually went out', endsInAList(WAS_PUBLISHED), true);
eq('...and the marker check did NOT, which is why this one exists',
  hasEditorNotes(WAS_PUBLISHED), false);

// A sermon that quotes a list mid-message is not a sermon that ends in one.
const LIST_IN_THE_MIDDLE = `He gave us three things to carry:

- faith
- hope
- love

And then he prayed with us. Amen.`;
eq('a list inside the sermon is fine', endsInAList(LIST_IN_THE_MIDDLE), false);

console.log(`\n${published.length} published sermons checked`);
console.log(fail === 0 ? '\nall passed' : `\n${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
