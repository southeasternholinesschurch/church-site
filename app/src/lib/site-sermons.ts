/**
 * Sermons, for the dashboard.
 *
 * Kept apart from site-entries.ts because sermons are not shaped like staff or
 * ministries. There are sixty of them rather than five, their filenames encode
 * the date, most are written by the importer rather than a person, and they
 * carry a review step that nothing else has.
 *
 * THE PAGE SIZE IS NOT COSMETIC. A Worker on this plan may make 50 outbound
 * requests per incoming request, and reading one sermon is one of them. Listing
 * all sixty would blow the cap and fail — the same limit that silently dropped
 * text recipients before the send route was sliced. Twenty per page leaves
 * room for the directory listings and the drafts.
 */
import {
  readFile, listDir, writeFile, deleteFile, commitMessage, type GitEnv,
  YAML_OUT,
} from './site-content.ts';
import { parseDocument } from 'yaml';

export const SERMONS_DIR = 'site/src/content/sermons';
export const DRAFTS_DIR = 'site/transcripts/drafts';
export const TRANSCRIPTS_DIR = 'site/transcripts';
export const SERIES_DIR = 'site/src/content/series';

/** Comfortably inside the 50-subrequest cap, with room for the other reads. */
export const PAGE_SIZE = 20;

export interface SermonRow {
  slug: string;
  date: string;
  serviceType: string;
  title: string;
  speaker: string;
  series: string;
  hasBody: boolean;
  hasTranscript: boolean;
  hasDraft: boolean;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** "2026-09-06-sunday-morning" -> date and service, with no network call. */
export function fromSlug(slug: string): { date: string; serviceType: string } {
  const m = /^(\d{4}-\d{2}-\d{2})-(.+)$/.exec(slug);
  return { date: m?.[1] ?? '', serviceType: m?.[2] ?? '' };
}

export interface SermonPage { rows: SermonRow[]; total: number; page: number; pages: number }

export async function listSermons(env: GitEnv, page = 0): Promise<SermonPage> {
  const files = (await listDir(env, SERMONS_DIR))
    .filter((f) => f.name.endsWith('.md'))
    .map((f) => f.name.replace(/\.md$/, ''))
    // Newest first: the sermon somebody wants is almost always a recent one.
    .sort((a, b) => (a < b ? 1 : -1));

  const transcripts = new Set((await listDir(env, TRANSCRIPTS_DIR))
    .filter((f) => f.name.endsWith('.txt')).map((f) => f.name.replace(/\.txt$/, '')));
  const drafts = new Set((await listDir(env, DRAFTS_DIR))
    .filter((f) => f.name.endsWith('.md') && f.name !== 'README.md')
    .map((f) => f.name.replace(/\.md$/, '')));

  const pages = Math.max(1, Math.ceil(files.length / PAGE_SIZE));
  const slice = files.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const rows = await Promise.all(slice.map(async (slug): Promise<SermonRow> => {
    const file = await readFile(env, `${SERMONS_DIR}/${slug}.md`);
    const m = file ? FRONTMATTER.exec(file.text) : null;
    const data = m ? (parseDocument(m[1]).toJS() ?? {}) : {};
    return {
      slug,
      ...fromSlug(slug),
      title: String(data.title ?? ''),
      speaker: String(data.speaker ?? ''),
      series: String(data.series ?? ''),
      hasBody: Boolean(m && m[2].trim()),
      hasTranscript: transcripts.has(slug),
      hasDraft: drafts.has(slug),
    };
  }));

  return { rows, total: files.length, page, pages };
}

export interface SermonDetail {
  slug: string;
  data: Record<string, unknown>;
  body: string;
  sha: string;
  draft: { text: string; sha: string; suggested: Record<string, string> } | null;
  hasTranscript: boolean;
}

export async function readSermon(env: GitEnv, slug: string): Promise<SermonDetail | null> {
  const file = await readFile(env, `${SERMONS_DIR}/${slug}.md`);
  if (!file) return null;
  const m = FRONTMATTER.exec(file.text);
  const draftFile = await readFile(env, `${DRAFTS_DIR}/${slug}.md`).catch(() => null);
  const transcript = await readFile(env, `${TRANSCRIPTS_DIR}/${slug}.txt`).catch(() => null);
  return {
    slug,
    data: m ? (parseDocument(m[1]).toJS() ?? {}) : {},
    body: m ? m[2] : '',
    sha: file.sha,
    draft: draftFile
      ? { ...splitDraft(draftFile.text), sha: draftFile.sha }
      : null,
    hasTranscript: Boolean(transcript),
  };
}

export async function listSeries(env: GitEnv): Promise<{ slug: string; name: string }[]> {
  const files = (await listDir(env, SERIES_DIR)).filter((f) => f.name.endsWith('.md'));
  return Promise.all(files.map(async (f) => {
    const slug = f.name.replace(/\.md$/, '');
    const file = await readFile(env, `${SERIES_DIR}/${f.name}`);
    const m = file ? FRONTMATTER.exec(file.text) : null;
    const data = m ? (parseDocument(m[1]).toJS() ?? {}) : {};
    return { slug, name: String(data.name ?? slug) };
  }));
}

/** Metadata only — the body is written by publishing a draft, not typed here. */
const EDITABLE = ['title', 'speaker', 'scripture', 'series', 'image'] as const;

export async function saveSermon(
  env: GitEnv, slug: string, values: Record<string, string>,
  body: string, sha: string | undefined, who: { email: string },
): Promise<void> {
  const path = `${SERMONS_DIR}/${slug}.md`;
  const existing = await readFile(env, path);
  const m = existing ? FRONTMATTER.exec(existing.text) : null;
  const doc = parseDocument(m ? m[1] : '{}');

  for (const key of EDITABLE) {
    const v = (values[key] ?? '').trim();
    if (v) doc.set(key, v);
    else if (doc.has(key)) doc.delete(key);
  }

  const text = `---\n${YAML_OUT(doc).trimEnd()}\n---\n\n${body.trim()}\n`;
  await writeFile(env, {
    path, content: text, sha: sha ?? existing?.sha,
    message: commitMessage(`Sermon: ${values.title || slug}`, who),
  });
}


/**
 * The suggested details a cleaning run may leave at the top of a draft:
 *
 *     ---
 *     title: "The Triumphal Entry"
 *     scripture: "Matthew 21:1-11"
 *     ---
 *
 * Both are guesses made by whatever read the sermon, and they exist to save
 * the pastor typing what the transcript already says. They reach the sermon's
 * frontmatter only when he approves the draft, and only into fields nobody has
 * filled in already.
 *
 * A block is only a block if every line in it parses, so a transcript that
 * opened with a horizontal rule keeps its first paragraphs instead of losing
 * them to a frontmatter block that was never there.
 *
 * Kept here rather than imported for the same reason as stripEditorNotes: this
 * bundles for Workers. site/scripts/lib/draft-front.mjs is the same rule, and
 * test/draft-suggestions.test.ts runs both against the same cases.
 */
const DRAFT_FRONT = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;
const DRAFT_LINE = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/;

/** The keys a draft may suggest. Everything else in the block is dropped. */
export const SUGGESTED_KEYS = ['title', 'scripture'] as const;

function unquote(raw: string): string {
  const v = raw.trim();
  if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (v.length > 1 && v.startsWith("'") && v.endsWith("'")) {
    return v.slice(1, -1).replace(/''/g, "'");
  }
  return v;
}

export function splitDraft(raw: string): { suggested: Record<string, string>; text: string } {
  const full = String(raw ?? '');
  const m = DRAFT_FRONT.exec(full);
  if (!m) return { suggested: {}, text: full.trim() };

  const lines = m[1].split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length || !lines.every((l) => DRAFT_LINE.test(l.trim()))) {
    return { suggested: {}, text: full.trim() };
  }

  const suggested: Record<string, string> = {};
  for (const line of lines) {
    const f = DRAFT_LINE.exec(line.trim())!;
    if (!(SUGGESTED_KEYS as readonly string[]).includes(f[1])) continue;
    const v = unquote(f[2]);
    if (v) suggested[f[1]] = v;
  }
  return { suggested, text: full.slice(m[0].length).trim() };
}

/**
 * Any line that announces the editor's notes: the HTML comment the cleaning
 * routine asks for, or a heading or bold line in case a run writes it that way.
 */
const EDITOR_NOTES = /^[ \t]*(?:<!--[ \t]*|#{1,6}[ \t]*|\*\*[ \t]*)editor'?s?[ \t]+notes\b/im;

/**
 * The transcript up to the editor's notes.
 *
 * THE MARKER IS A TERMINATOR, NOT A WRAPPER. This used to strip the marker as
 * though it were a comment wrapped around the notes, which is not what the
 * routine produces:
 *
 *     <!-- editor's notes -->
 *     - Mark 6:3 came through as "Joseph"; the KJV reads "Joses".
 *
 * Removing "the comment" removed the first line and published the bullets under
 * the pastor's name. Three sermons went up that way before anyone noticed.
 * A sermon ends with the preaching; nothing follows it.
 *
 * Kept here rather than imported because this bundles for Workers. The copy in
 * site/scripts/lib/editor-notes.mjs is the same rule, and
 * test/editor-notes.test.ts runs both against the same cases so they cannot
 * drift apart.
 */
export function stripEditorNotes(text: string): string {
  const m = EDITOR_NOTES.exec(text);
  return (m ? text.slice(0, m.index) : text).trimEnd();
}

/** Whether a piece of text still carries notes — for checking, not for cutting. */
export function hasEditorNotes(text: string): boolean {
  return EDITOR_NOTES.test(text);
}

/**
 * Keep an edit to a draft without publishing it.
 *
 * Reviewing a long transcript is not one sitting, and the review form is the
 * only place a person ever sees a draft. Without this, stopping halfway meant
 * either publishing something half-read or throwing the reading away — so the
 * Save button now writes the draft back exactly as it stands.
 *
 * The suggested title and passage at the top of the draft are NOT written back.
 * They exist to fill in the form; the same save has just carried them into the
 * sermon's own frontmatter, and leaving a second copy behind would mean a later
 * save quietly reinstating a guess the pastor had already replaced.
 *
 * Does nothing when there is no draft, and nothing when the text is unchanged —
 * a Save that only touched the title should not produce a commit saying the
 * transcript was edited.
 */
export async function saveDraft(
  env: GitEnv, slug: string, text: string, who: { email: string },
): Promise<void> {
  const path = `${DRAFTS_DIR}/${slug}.md`;
  const existing = await readFile(env, path);
  if (!existing) return;
  const content = `${text.trim()}\n`;
  if (content === existing.text) return;
  await writeFile(env, {
    path, content, sha: existing.sha,
    message: commitMessage(`Sermon: save the draft for ${slug} without publishing`, who),
  });
}

/**
 * Approve a cleaned transcript: it becomes the sermon's page, and the draft is
 * removed so it cannot be published twice.
 *
 * Refuses if the sermon already has a body. That is somebody's work — possibly
 * typed by hand — and silently replacing it is not a thing an Approve button
 * should be able to do.
 *
 * `values` are the details as the reviewer left them on the form, saved in the
 * same commit as the transcript. Approving used to write the transcript alone
 * and carry the old details over, so a title and a passage typed while reading
 * the draft were thrown away by the very button that published it, and had to
 * be typed again afterwards. Omit them and the sermon keeps what it had.
 */
export async function publishDraft(
  env: GitEnv, slug: string, who: { email: string },
  opts: { edited?: string; values?: Record<string, string> } = {},
): Promise<{ words: number }> {
  const sermon = await readSermon(env, slug);
  if (!sermon) throw new Error('That sermon no longer exists.');
  if (!sermon.draft) throw new Error('There is no draft for that sermon.');
  if (sermon.body.trim()) throw new Error('That sermon already has text on its page. Clear it first if you mean to replace it.');

  // Editor's notes are addressed to the reviewer, not to the congregation.
  const text = stripEditorNotes(opts.edited ?? sermon.draft.text).trim();

  const values: Record<string, string> = {};
  for (const key of EDITABLE) {
    values[key] = opts.values?.[key] ?? String(sermon.data[key] ?? '');
  }
  await saveSermon(env, slug, values, text, sermon.sha, who);

  await deleteFile(env, `${DRAFTS_DIR}/${slug}.md`, sermon.draft.sha,
    commitMessage(`Sermon: publish the cleaned transcript for ${slug}`, who));

  return { words: text.split(/\s+/).filter(Boolean).length };
}

/**
 * Remove a sermon from the site entirely.
 *
 * Needed because the archive can end up with a service on it twice: the slug
 * is date + service type, the service type is read off the YouTube title, and
 * titles get edited after the stream. A stream that goes up as "Evening
 * Worship" and is retitled to "Sunday School and Evening Worship" gets filed a
 * second time by the next night's import. The importer refuses to do that now,
 * but somebody still has to say which of the two entries is the wrong one, and
 * without this that means editing the repository by hand.
 *
 * The draft goes with it, if one is still waiting. Leaving a draft behind
 * would make the sermon reappear in the review queue with no page to publish
 * it to.
 *
 * Deliberately not reversible from here. It is a git commit, so the text is
 * recoverable by someone who knows how, but this is not an "archive" or a
 * trash can and should not read like one.
 */
export async function deleteSermon(
  env: GitEnv, slug: string, who: { email: string },
): Promise<{ hadTranscript: boolean; hadDraft: boolean }> {
  const sermon = await readSermon(env, slug);
  if (!sermon) throw new Error('That sermon no longer exists.');

  const hadTranscript = sermon.body.trim().length > 0;
  const hadDraft = Boolean(sermon.draft);

  await deleteFile(env, `${SERMONS_DIR}/${slug}.md`, sermon.sha,
    commitMessage(`Sermon: remove ${slug}`, who));

  if (sermon.draft) {
    await deleteFile(env, `${DRAFTS_DIR}/${slug}.md`, sermon.draft.sha,
      commitMessage(`Sermon: remove the draft for ${slug} along with it`, who));
  }

  return { hadTranscript, hadDraft };
}
