/**
 * Member portrait storage.
 *
 * Portraits live in R2, not in D1 and not in the repo. Two reasons, both
 * hard: a few hundred JPEGs would bloat every row read out of the people
 * table, and anything in the repo is public — a member's face is member data
 * and belongs behind the same door as their phone number.
 *
 * Every function here tolerates R2 being absent. Until the bucket is enabled
 * on the Cloudflare account the binding is not present, and the correct
 * behaviour is "photos aren't switched on yet", not a 500.
 */

export interface PhotoEnv { PHOTOS?: R2Bucket }

/** Whether photo storage is actually wired up in this environment. */
export const photosEnabled = (env: PhotoEnv): boolean => Boolean(env.PHOTOS);

/** What a phone camera produces is far bigger than a 128px avatar needs. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/**
 * Accepted types, checked against the file's actual leading bytes rather than
 * the browser-supplied Content-Type. The type header is attacker-controlled;
 * the magic number is what the bytes really are. This matters because these
 * files are served back out to browsers.
 */
const SIGNATURES: Array<{ mime: string; test: (b: Uint8Array) => boolean }> = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png',  test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/webp', test: (b) =>
      b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
];

/** The real image type, or null if these bytes are not an image we accept. */
export function sniffImage(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  return SIGNATURES.find((s) => s.test(bytes))?.mime ?? null;
}

/**
 * Store a portrait and return its object key.
 *
 * The key carries a random suffix rather than being just the person id, so
 * that replacing a photo produces a NEW url. A stable url would be served
 * from the old cached bytes for as long as the browser kept them — someone
 * would replace a bad photo and keep seeing it.
 */
export async function putPhoto(
  env: PhotoEnv, personId: number, bytes: Uint8Array, mime: string,
): Promise<string> {
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const key = `people/${personId}/${crypto.randomUUID()}.${ext}`;
  await env.PHOTOS!.put(key, bytes, { httpMetadata: { contentType: mime } });
  return key;
}

/** Best-effort removal of the previous portrait. Never throws. */
export async function deletePhoto(env: PhotoEnv, key: string | null): Promise<void> {
  if (!key || !env.PHOTOS) return;
  try { await env.PHOTOS.delete(key); } catch { /* an orphan object is harmless */ }
}
