/**
 * Reading and writing the public site's content, from the staff app.
 *
 * The site's content lives as markdown and YAML in the git repository, not in
 * this database, and that stays true — see handoff/ANALYSIS-architecture.md for
 * why. The consequence is that "save" here means "commit", which has one large
 * advantage over a database row: a commit triggers the site build, so an edit
 * publishes itself in about two minutes with nothing else to press.
 *
 * It also means every edit keeps a diff and an author, for free.
 *
 * This replaces Decap CMS and its OAuth Worker. A church setting the site up
 * now pastes one token instead of registering a GitHub OAuth App and deploying
 * a proxy — a step whose own documentation had to warn that getting it wrong
 * fails silently in the browser console.
 */

export interface GitEnv {
  /** Fine-grained PAT, Contents: read and write, on this repository only. */
  GITHUB_TOKEN?: string;
  /** "owner/name". */
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
}

export const siteEditingConfigured = (env: GitEnv): boolean =>
  Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO);

/**
 * Enough about the credential to diagnose it, and nothing that could leak it.
 *
 * A 401 from GitHub means "bad credentials" and nothing more, which leaves you
 * guessing between a truncated paste, the wrong token, and the wrong Worker.
 * Length and first characters settle it in seconds — a fine-grained token is
 * 93 characters and starts github_pat_, so a short one was clipped and a
 * ghp_ one is a classic token that will not carry these permissions.
 */
export function tokenShape(env: GitEnv): {
  present: boolean; length: number; prefix: string; looksRight: boolean; repo: string;
} {
  const t = env.GITHUB_TOKEN ?? '';
  return {
    present: Boolean(t),
    length: t.length,
    prefix: t.slice(0, 11),
    looksRight: t.startsWith('github_pat_') && t.length > 80 && t === t.trim(),
    repo: env.GITHUB_REPO ?? '(not set)',
  };
}

const API = 'https://api.github.com';
const branchOf = (env: GitEnv) => env.GITHUB_BRANCH || 'main';

export class GitError extends Error {
  /**
   * A plain field, not a `readonly status` parameter property. This project's
   * tests run on `node --experimental-strip-types`, which refuses parameter
   * properties outright — so writing it the idiomatic TypeScript way would
   * make this module the one thing in the app that cannot be unit-tested.
   */
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
/** Somebody else changed the file between our read and our write. */
export class GitConflict extends GitError {}

/**
 * Base64 for the GitHub API, via UTF-8.
 *
 * btoa() alone throws on anything outside Latin-1, and this content is full of
 * em dashes and curly quotes — so the naive version works in testing and fails
 * the first time somebody types a proper apostrophe.
 */
function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(b64: string): string {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function gh(env: GitEnv, path: string, init: RequestInit = {}): Promise<Response> {
  if (!siteEditingConfigured(env)) throw new GitError('Site editing is not configured.', 500);
  return fetch(`${API}/repos/${env.GITHUB_REPO}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
      // GitHub rejects requests without one, and a vague agent makes an
      // incident harder to trace back than it needs to be.
      'user-agent': 'church-staff-app',
      ...(init.headers ?? {}),
    },
  });
}

export interface SiteFile { path: string; text: string; sha: string; }

/** Null when the file does not exist — which is a normal answer, not a fault. */
export async function readFile(env: GitEnv, path: string): Promise<SiteFile | null> {
  const res = await gh(env, `/contents/${path}?ref=${branchOf(env)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new GitError(`Could not read ${path} (${res.status}).`, res.status);
  const body = await res.json() as { content: string; sha: string };
  return { path, text: fromBase64(body.content), sha: body.sha };
}

/**
 * Raw bytes, for images.
 *
 * Deliberately NOT readFile: that decodes as UTF-8, which turns a JPEG into
 * replacement characters silently. It also asks for the `raw` media type
 * rather than the default JSON-with-base64, because the JSON form is capped at
 * 1MB and some of these photographs are larger than that.
 */
export async function readBinary(env: GitEnv, path: string): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  const res = await gh(env, `/contents/${path}?ref=${branchOf(env)}`, {
    headers: { accept: 'application/vnd.github.raw' },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new GitError(`Could not read ${path} (${res.status}).`, res.status);
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp'
    : ext === 'avif' ? 'image/avif' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg';
  return { bytes: await res.arrayBuffer(), type };
}

export async function listDir(env: GitEnv, path: string): Promise<{ name: string; path: string; sha: string; size: number }[]> {
  const res = await gh(env, `/contents/${path}?ref=${branchOf(env)}`);
  if (res.status === 404) return [];
  if (!res.ok) throw new GitError(`Could not list ${path} (${res.status}).`, res.status);
  const body = await res.json();
  return Array.isArray(body) ? body.filter((f: any) => f.type === 'file') : [];
}

async function put(env: GitEnv, path: string, contentB64: string, message: string, sha?: string) {
  const res = await gh(env, `/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: contentB64, branch: branchOf(env), ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 || res.status === 422) {
    throw new GitConflict(`${path} changed underneath this edit.`, res.status);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new GitError(`Could not save ${path} (${res.status}). ${detail.slice(0, 200)}`, res.status);
  }
  return res.json() as Promise<{ commit: { sha: string } }>;
}

/**
 * Write a text file and commit it.
 *
 * Pass the sha you read, so a concurrent edit is a CONFLICT rather than a
 * silent overwrite. On conflict this retries ONCE against the current sha,
 * using the caller's `merge` to decide what the new content should be — and
 * gives up rather than looping, because a file changing twice inside one save
 * means something is wrong that a retry will not fix.
 */
export async function writeFile(
  env: GitEnv,
  opts: {
    path: string; content: string; message: string; sha?: string;
    /** Called if the file moved under us. Return the content to write instead. */
    merge?: (current: SiteFile) => string;
  },
): Promise<{ commitSha: string }> {
  try {
    const r = await put(env, opts.path, toBase64(opts.content), opts.message, opts.sha);
    return { commitSha: r.commit.sha };
  } catch (err) {
    if (!(err instanceof GitConflict)) throw err;
    const current = await readFile(env, opts.path);
    if (!current) throw err;
    const content = opts.merge ? opts.merge(current) : opts.content;
    const r = await put(env, opts.path, toBase64(content), `${opts.message} (after a concurrent edit)`, current.sha);
    return { commitSha: r.commit.sha };
  }
}

/** Images and other binaries — the caller has already sized them sensibly. */
export async function writeBinary(
  env: GitEnv, opts: { path: string; bytes: Uint8Array; message: string; sha?: string },
): Promise<{ commitSha: string }> {
  let binary = '';
  for (const b of opts.bytes) binary += String.fromCharCode(b);
  const r = await put(env, opts.path, btoa(binary), opts.message, opts.sha);
  return { commitSha: r.commit.sha };
}

export async function deleteFile(env: GitEnv, path: string, sha: string, message: string): Promise<void> {
  const res = await gh(env, `/contents/${path}`, {
    method: 'DELETE',
    body: JSON.stringify({ message, sha, branch: branchOf(env) }),
  });
  if (!res.ok) throw new GitError(`Could not delete ${path} (${res.status}).`, res.status);
}

/**
 * Commit messages name the person, so the site's history reads as a log of who
 * changed what rather than as a wall of identical automated lines.
 */
export const commitMessage = (what: string, who: { email: string }) =>
  `${what}\n\nEdited in the staff dashboard by ${who.email}.`;
