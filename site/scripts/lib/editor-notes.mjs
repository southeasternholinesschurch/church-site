/**
 * Cut the editor's notes off the end of a cleaned transcript.
 *
 * The notes are written for whoever reviews the draft — what the ASR got wrong,
 * a scripture that was corrected, a passage the agent could not hear. They are
 * not for the congregation, and they must never appear on a sermon page under
 * the pastor's name.
 *
 * THE MARKER IS A TERMINATOR, NOT A WRAPPER. It used to be treated as an HTML
 * comment to be removed, which is what the routine's own example looked like:
 *
 *     <!-- editor's notes -->
 *     - Mark 6:3 came through as "Joseph"; the KJV reads "Joses".
 *
 * Removing "the comment" removed the first line and published the bullets.
 * Three sermons went up that way. So: everything from the marker to the end of
 * the text goes, whether the notes sit inside the comment or beneath it.
 *
 * A sermon ends with the preaching. Nothing follows it.
 *
 * app/src/lib/site-sermons.ts has its own copy of this, because the staff app
 * bundles for Workers and cannot import from here. app/test/editor-notes.test.ts
 * runs both against the same cases so they cannot drift apart.
 */

/**
 * Any line that announces the notes: the HTML comment the routine asks for, or
 * a heading or bold line, in case a run writes it that way instead. Generous on
 * purpose — the cost of matching one line too many is a note that stays in the
 * draft, and the cost of matching one too few is internal commentary published
 * on the church's website.
 */
const MARKER = /^[ \t]*(?:<!--[ \t]*|#{1,6}[ \t]*|\*\*[ \t]*)editor'?s?[ \t]+notes\b/im;

/** The transcript up to the editor's notes, with trailing blank lines removed. */
export function stripEditorNotes(text) {
  const m = MARKER.exec(text);
  return (m ? text.slice(0, m.index) : text).trimEnd();
}

/** Whether a piece of text still carries notes — for checking, not for cutting. */
export function hasEditorNotes(text) {
  return MARKER.test(text);
}
