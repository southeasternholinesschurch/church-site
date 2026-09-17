/**
 * The suggested details a cleaning run leaves at the top of a draft.
 *
 * A draft may open with a small frontmatter block:
 *
 *     ---
 *     title: "The Triumphal Entry"
 *     scripture: "Matthew 21:1-11"
 *     ---
 *
 *     Before we get into the lesson — somebody sent pictures yesterday…
 *
 * Neither key is an assertion. The run has just read the whole sermon, so it
 * knows what he preached from and roughly what it was about, and writing that
 * down costs nothing; but it is a guess, and it lands in the review form as a
 * starting point the pastor types over. It is kept in the DRAFT rather than written
 * straight into the sermon file on purpose — the draft is the side of the
 * review gate the routine is allowed to touch, and a sermon nobody has
 * approved should not be carrying an agent's guess about its own text.
 *
 * Only `title` and `scripture` are read. Anything else in the block is ignored
 * rather than trusted: this is the one place where a machine-written value
 * crosses into the sermon's frontmatter, and the narrow list is what keeps that
 * crossing small.
 *
 * Hand-rolled rather than handed to the `yaml` package because these scripts
 * are plain node run by hand, with no toolchain, and because app/src/lib/
 * site-sermons.ts has to carry the same rule for Workers — two implementations
 * of two lines of parsing agree far more easily than two of a YAML loader.
 * app/test/draft-suggestions.test.ts runs both against the same cases.
 */

/** The opening block, and only at the very start of the file. */
const FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;
const LINE = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/;

/** The keys a draft may suggest. Everything else in the block is dropped. */
export const SUGGESTED_KEYS = ['title', 'scripture'];

function unquote(raw) {
  const v = raw.trim();
  if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (v.length > 1 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

/** Quote a value so a colon in "Matthew 21:1-11" cannot break the block. */
export function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * A draft split into its suggestions and the transcript itself.
 *
 * Always returns the transcript, with or without a block — drafts written
 * before this existed, and any a run writes without a guess to offer, are
 * ordinary text and must keep working untouched.
 *
 * A block is only a block if every line in it parses. A transcript that
 * happened to open with a horizontal rule would otherwise have its first
 * paragraphs swallowed as frontmatter, which is a far worse failure than
 * ignoring a malformed block.
 */
export function splitDraft(raw) {
  const full = String(raw ?? '');
  const m = FRONT.exec(full);
  if (!m) return { suggested: {}, text: full.trim() };

  const lines = m[1].split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length || !lines.every((l) => LINE.test(l.trim()))) {
    return { suggested: {}, text: full.trim() };
  }

  const suggested = {};
  for (const line of lines) {
    const f = LINE.exec(line.trim());
    if (!SUGGESTED_KEYS.includes(f[1])) continue;
    const v = unquote(f[2]);
    if (v) suggested[f[1]] = v;
  }
  return { suggested, text: full.slice(m[0].length).trim() };
}

/** The other direction: a draft file's contents, for a run to write. */
export function draftText(suggested, text) {
  const keys = SUGGESTED_KEYS.filter((k) => String(suggested?.[k] ?? '').trim());
  const body = `${String(text).trim()}\n`;
  if (!keys.length) return body;
  const block = keys.map((k) => `${k}: ${quote(String(suggested[k]).trim())}`);
  return `---\n${block.join('\n')}\n---\n\n${body}`;
}
