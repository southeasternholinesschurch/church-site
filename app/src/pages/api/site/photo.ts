import type { APIRoute } from 'astro';
import { readFile, writeBinary, siteEditingConfigured, commitMessage } from '../../../lib/site-content';

export const prerender = false;

/**
 * Commits a photograph the browser has already shrunk.
 *
 * It arrives resized because a Worker cannot resize it — see the note on the
 * photos page. This route's job is to be suspicious about what it is handed:
 * the folder, the name and the bytes all come from a browser, and only the
 * first two are easy to sanitise.
 */
/**
 * `uploads` is site/public/uploads — the homepage banner's image, and the only
 * one of these that is NOT run through the build's image pipeline. It is served
 * exactly as uploaded, which is precisely why the browser-side resize matters
 * more here than anywhere else.
 */
const FOLDERS = new Set(['photos', 'staff', 'series', 'sermons', 'uploads']);
const PUBLIC_FOLDERS = new Set(['uploads']);
/** 2400px of JPEG at quality 82 lands well under this. Anything larger is not
 *  a resized photograph, whatever it says it is. */
const MAX_BYTES = 3 * 1024 * 1024;

/** The first bytes of the file, not the label on it. */
function looksLikeImage(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return jpeg || png || webp;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'not signed in' }, 401);

  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ error: 'bad origin' }, 403);
  }

  const env = locals.runtime.env;
  if (!siteEditingConfigured(env)) return json({ error: 'Website editing is not connected yet.' }, 503);

  const body = await request.json().catch(() => null) as
    { folder?: string; slug?: string; dataBase64?: string } | null;
  if (!body) return json({ error: 'Could not read that upload.' }, 400);

  const folder = String(body.folder ?? '');
  if (!FOLDERS.has(folder)) return json({ error: 'Unknown folder.' }, 400);

  // Lowercase, hyphens, nothing else — this becomes a filename and a key.
  const slug = String(body.slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 60);
  if (!slug) return json({ error: 'That name has no usable characters in it.' }, 400);

  let bytes: Uint8Array;
  try {
    const bin = atob(String(body.dataBase64 ?? ''));
    bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return json({ error: 'That upload was not readable.' }, 400);
  }

  if (!bytes.length) return json({ error: 'That upload was empty.' }, 400);
  if (bytes.length > MAX_BYTES) {
    return json({ error: 'That is larger than a resized photograph should be.' }, 413);
  }
  if (!looksLikeImage(bytes)) {
    return json({ error: 'That file is not a JPEG, PNG or WebP.' }, 400);
  }

  // Always .jpg: the browser re-encodes to JPEG, so keeping the original
  // extension would name a JPEG "logo.png" and the glob would still find it —
  // a lie that only surfaces much later.
  const path = PUBLIC_FOLDERS.has(folder)
    ? `site/public/${folder}/${slug}.jpg`
    : `site/src/assets/${folder}/${slug}.jpg`;
  const existing = await readFile(env, path).catch(() => null);

  await writeBinary(env, {
    path, bytes, sha: existing?.sha,
    message: commitMessage(
      existing ? `Photo: replace ${folder}/${slug}` : `Photo: add ${folder}/${slug}`, user),
  });

  return json({ ok: true, replaced: Boolean(existing), path });
};
