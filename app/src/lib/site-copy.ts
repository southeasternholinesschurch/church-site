/**
 * The words on each page of the public site.
 *
 * Most of the site's prose was written straight into the .astro files while it
 * was being built, so changing a sentence meant editing code. It now lives in
 * site/src/content/copy/<page>.yaml, one file per page, and this is what the
 * dashboard reads and writes.
 *
 * The pages keep their original text as a fallback, so nothing here can empty a
 * heading: a key that goes missing shows yesterday's sentence instead.
 */
import { parseDocument } from 'yaml';
import { readFile, writeFile, listDir, commitMessage, YAML_OUT, type GitEnv } from './site-content.ts';

export const COPY_DIR = 'site/src/content/copy';

/** Pages that have a copy file, and what to call them in the dashboard. */
export const PAGE_LABELS: Record<string, string> = {
  // The menu and footer come first because they are on every page; the rest
  // read in the order someone would walk the site.
  navigation: 'Menu & footer',
  home: 'Home',
  about: 'About',
  'im-new': "I'm New",
  contact: 'Contact',
  give: 'Give',
  events: 'Events',
  livestream: 'Livestream',
  sermons: 'Sermons',
  ministries: 'Ministries',
  beliefs: 'What we believe',
  staff: 'Staff page',
  directory: 'Directory',
  bulletin: 'Bulletin',
  'thank-you': 'After sending a message',
};

export interface CopyField { path: string; value: string; group: string; label: string }

/** "hero.primaryButton" -> group "Hero", label "Primary button". */
function describe(path: string): { group: string; label: string } {
  const parts = path.split('.');
  const leaf = parts.pop() ?? path;
  const words = (s: string) => s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
  return {
    group: parts.length ? parts.map(words).join(' · ') : 'Page',
    label: words(leaf),
  };
}

/** Every string leaf, as a dotted path. Nothing else is editable here. */
function flatten(node: unknown, prefix: string, out: CopyField[]): void {
  if (node == null) return;
  if (typeof node === 'string') {
    out.push({ path: prefix, value: node, ...describe(prefix) });
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
    return;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
}

export async function listCopyPages(env: GitEnv): Promise<{ page: string; label: string }[]> {
  const files = await listDir(env, COPY_DIR);
  return files
    .filter((f) => f.name.endsWith('.yaml'))
    .map((f) => f.name.replace(/\.yaml$/, ''))
    .map((page) => ({ page, label: PAGE_LABELS[page] ?? page }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * A copy file's text -> the fields the dashboard draws, in file order.
 *
 * Separate from readCopyPage so the part the editor actually sees — what the
 * groups are called, what each field is called, which fields appear at all —
 * can be checked against the real files without reaching GitHub for them.
 */
export function copyFields(text: string): CopyField[] {
  const fields: CopyField[] = [];
  flatten(parseDocument(text).toJS() ?? {}, '', fields);
  return fields;
}

export async function readCopyPage(
  env: GitEnv, page: string,
): Promise<{ fields: CopyField[]; sha: string } | null> {
  const file = await readFile(env, `${COPY_DIR}/${page}.yaml`);
  if (!file) return null;
  return { fields: copyFields(file.text), sha: file.sha };
}

export async function saveCopyPage(
  env: GitEnv, page: string, values: Record<string, string>,
  sha: string | undefined, who: { email: string },
): Promise<void> {
  const path = `${COPY_DIR}/${page}.yaml`;
  const file = await readFile(env, path);
  const doc = parseDocument(file?.text ?? '{}');

  // setIn on each leaf, so the file's comments and ordering survive — the same
  // reason site.yaml is edited this way. Replacing the document would delete
  // the notes explaining what each section is.
  for (const [dotted, v] of Object.entries(values)) {
    const segs = dotted.split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s));
    doc.setIn(segs, v);
  }

  await writeFile(env, {
    path, content: YAML_OUT(doc), sha: sha ?? file?.sha,
    message: commitMessage(`Page text: ${PAGE_LABELS[page] ?? page}`, who),
  });
}
