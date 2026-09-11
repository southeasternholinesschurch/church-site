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
} from './site-content';
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
  draft: { text: string; sha: string } | null;
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
    draft: draftFile ? { text: draftFile.text, sha: draftFile.sha } : null,
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
 * Approve a cleaned transcript: it becomes the sermon's page, and the draft is
 * removed so it cannot be published twice.
 *
 * Refuses if the sermon already has a body. That is somebody's work — possibly
 * typed by hand — and silently replacing it is not a thing an Approve button
 * should be able to do.
 */
export async function publishDraft(
  env: GitEnv, slug: string, who: { email: string }, edited?: string,
): Promise<{ words: number }> {
  const sermon = await readSermon(env, slug);
  if (!sermon) throw new Error('That sermon no longer exists.');
  if (!sermon.draft) throw new Error('There is no draft for that sermon.');
  if (sermon.body.trim()) throw new Error('That sermon already has text on its page. Clear it first if you mean to replace it.');

  // Editor's notes are addressed to the reviewer, not to the congregation.
  const text = (edited ?? sermon.draft.text)
    .replace(/<!--\s*editor'?s notes[\s\S]*?-->/gi, '').trim();

  await saveSermon(env, slug, {
    title: String(sermon.data.title ?? ''),
    speaker: String(sermon.data.speaker ?? ''),
    scripture: String(sermon.data.scripture ?? ''),
    series: String(sermon.data.series ?? ''),
    image: String(sermon.data.image ?? ''),
  }, text, sermon.sha, who);

  await deleteFile(env, `${DRAFTS_DIR}/${slug}.md`, sermon.draft.sha,
    commitMessage(`Sermon: publish the cleaned transcript for ${slug}`, who));

  return { words: text.split(/\s+/).filter(Boolean).length };
}
