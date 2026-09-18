/**
 * Markdown entries — staff, ministries, beliefs — read and written as content.
 *
 * Each is a file with a YAML frontmatter block and a markdown body. The
 * frontmatter carries comments, the same as site.yaml does ("already a square
 * studio portrait, so the circle doesn't crop it"), so it is edited through a
 * YAML Document rather than rebuilt from an object. Losing those is silent and
 * permanent, and they are the only place some of this reasoning is recorded.
 */
import { parseDocument } from 'yaml';
import {
  readFile, writeFile, deleteFile, listDir, commitMessage, type GitEnv,
  YAML_OUT,
} from './site-content';

export type CollectionId = 'staff' | 'ministries' | 'beliefs';

export interface FieldDef {
  name: string;
  label: string;
  /** `text` is one line; `area` is several; `number` and `select` as named. */
  kind: 'text' | 'area' | 'number' | 'select';
  options?: readonly string[];
  hint?: string;
  required?: boolean;
}

/**
 * What each collection actually holds. Kept here rather than inferred from the
 * site's Zod schema because the two live in different projects — and because
 * an editor needs wording a schema does not carry.
 */
export interface PhotoSpec {
  /** Field holding the filename key. */
  field: string;
  /** Asset folder the filename lives in. */
  folder: 'photos' | 'staff';
  /** Field holding the focal point, and the shape it takes. */
  focusField: string;
  /**
   * `point` is a CSS object-position ("50% 35%"); `vertical` is a bare
   * percentage, which is what the circular staff crop uses.
   */
  focusKind: 'point' | 'vertical';
  /** How the photo is cropped where it appears, so the picker can show it. */
  preview: 'wide' | 'circle';
}

export const COLLECTIONS: Record<CollectionId, {
  label: string; singular: string; dir: string; titleField: string; fields: FieldDef[];
  photo?: PhotoSpec;
}> = {
  staff: {
    label: 'Staff & leadership', singular: 'person',
    dir: 'site/src/content/staff', titleField: 'name',
    fields: [
      { name: 'name', label: 'Name', kind: 'text', required: true },
      { name: 'role', label: 'Role', kind: 'text', required: true, hint: 'Pastor, Youth Minister, Children\'s Director…' },
      { name: 'order', label: 'Position in the list', kind: 'number', hint: '1 shows first.' },
      { name: 'photo', label: 'Photo', kind: 'text', hint: 'The filename in site/src/assets/staff/, without the extension. Leave empty for a "Photo needed" marker.' },
      { name: 'focus', label: 'Vertical focus (%)', kind: 'number', hint: 'Portraits are cropped to a circle. 22 suits a seated portrait; 50 is centred. Only matters for tall photos.' },
      { name: 'photoAlt', label: 'Photo description', kind: 'text', hint: 'Only needed when the photo shows more than this person.' },
    ],
    photo: { field: 'photo', folder: 'staff', focusField: 'focus', focusKind: 'vertical', preview: 'circle' },
  },
  ministries: {
    label: 'Ministries', singular: 'ministry',
    dir: 'site/src/content/ministries', titleField: 'name',
    fields: [
      { name: 'name', label: 'Name', kind: 'text', required: true },
      { name: 'order', label: 'Position in the list', kind: 'number' },
      { name: 'ageRange', label: 'Who it is for', kind: 'text', hint: 'e.g. Ages 4–12' },
      { name: 'summary', label: 'Summary', kind: 'area', required: true, hint: 'One or two sentences, shown on the ministries page and in search results.' },
      { name: 'meets', label: 'When it meets', kind: 'text' },
      { name: 'where', label: 'Where it meets', kind: 'text' },
      { name: 'photo', label: 'Photo', kind: 'text', hint: 'Filename in site/src/assets/photos/, without the extension.' },
      { name: 'photoFocus', label: 'Photo crop', kind: 'text', hint: 'e.g. 50% 35%. The hero is wide, so this decides which band of a tall photo survives — worth checking after changing the photo.' },
      { name: 'photoAlt', label: 'Photo description', kind: 'text' },
    ],
    photo: { field: 'photo', folder: 'photos', focusField: 'photoFocus', focusKind: 'point', preview: 'wide' },
  },
  beliefs: {
    label: 'What we believe', singular: 'article',
    dir: 'site/src/content/beliefs', titleField: 'title',
    fields: [
      { name: 'title', label: 'Title', kind: 'text', required: true },
      { name: 'order', label: 'Position in the list', kind: 'number' },
    ],
  },
};

export interface Entry {
  slug: string;
  data: Record<string, unknown>;
  body: string;
  sha: string;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export async function listEntries(env: GitEnv, id: CollectionId): Promise<{ slug: string; data: Record<string, unknown> }[]> {
  const files = await listDir(env, COLLECTIONS[id].dir);
  const out: { slug: string; data: Record<string, unknown> }[] = [];
  for (const f of files) {
    if (!f.name.endsWith('.md')) continue;
    const entry = await readEntry(env, id, f.name.replace(/\.md$/, ''));
    if (entry) out.push({ slug: entry.slug, data: entry.data });
  }
  return out.sort((a, b) => Number(a.data.order ?? 999) - Number(b.data.order ?? 999));
}

export async function readEntry(env: GitEnv, id: CollectionId, slug: string): Promise<Entry | null> {
  const file = await readFile(env, `${COLLECTIONS[id].dir}/${slug}.md`);
  if (!file) return null;
  const m = FRONTMATTER.exec(file.text);
  if (!m) return { slug, data: {}, body: file.text, sha: file.sha };
  return { slug, data: parseDocument(m[1]).toJS() ?? {}, body: m[2], sha: file.sha };
}

export async function saveEntry(
  env: GitEnv, id: CollectionId, slug: string,
  values: Record<string, string>, body: string, sha: string | undefined, who: { email: string },
): Promise<void> {
  const path = `${COLLECTIONS[id].dir}/${slug}.md`;
  const existing = await readFile(env, path);
  const m = existing ? FRONTMATTER.exec(existing.text) : null;
  const doc = parseDocument(m ? m[1] : '{}');

  for (const field of COLLECTIONS[id].fields) {
    const raw = (values[field.name] ?? '').trim();
    if (!raw && !field.required) {
      // An emptied optional is a removal, not an empty string in the file.
      if (doc.has(field.name)) doc.delete(field.name);
      continue;
    }
    doc.set(field.name, field.kind === 'number' ? Number(raw) : raw);
  }

  const text = `---\n${YAML_OUT(doc).trimEnd()}\n---\n\n${body.trim()}\n`;
  await writeFile(env, {
    path, content: text, sha: sha ?? existing?.sha,
    message: commitMessage(
      `${COLLECTIONS[id].label}: update ${values[COLLECTIONS[id].titleField] || slug}`, who),
  });
}

export async function removeEntry(
  env: GitEnv, id: CollectionId, slug: string, who: { email: string },
): Promise<void> {
  const path = `${COLLECTIONS[id].dir}/${slug}.md`;
  const file = await readFile(env, path);
  if (!file) return;
  await deleteFile(env, path, file.sha, commitMessage(`${COLLECTIONS[id].label}: remove ${slug}`, who));
}

/** "Pastor Reeve" -> "pastor-reeve", which becomes the filename. */
export const toSlug = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
