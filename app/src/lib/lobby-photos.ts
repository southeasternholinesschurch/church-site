/**
 * Uploaded lobby photographs — the rules. Pure, shared by the editor, the API
 * and the tests; the database half is lib/lobby-photos-db.ts.
 */

/** Where the faces are, as the editor offers it. Fractions of the height. */
export const FACE_CHOICES = [
  { value: 0.3, label: 'Near the top' },
  { value: 0.45, label: 'In the middle' },
  { value: 0.6, label: 'Lower down' },
] as const;

export const ALT_MAX = 120;
/** The editor resizes to this width; a 4K screen shows the photo at most this wide. */
export const PHOTO_MAX_W = 2400;
/** Below this the photo looks soft on the TV; the editor warns. */
export const PHOTO_SOFT_W = 1600;

export interface PhotoFields { alt: string; face: number; uses: ('give' | 'guest')[] }

/**
 * Check what the editor sent. The description is required: it is the photo's
 * alt text, and the only thing anyone reviewing the list sees without opening
 * the picture.
 */
export function validatePhoto(input: { alt?: unknown; face?: unknown; give?: unknown; guest?: unknown }):
  { ok: true; value: PhotoFields } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const alt = String(input.alt ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!alt) errors.push('Describe the photo in a few words.');
  if (alt.length > ALT_MAX) errors.push(`The description is ${alt.length} characters; ${ALT_MAX} fit.`);
  const faceRaw = Number(input.face ?? 0.45);
  const face = FACE_CHOICES.find((f) => f.value === faceRaw)?.value ?? 0.45;
  const on = (v: unknown) => v === true || v === '1' || v === 'on';
  const uses = [...(on(input.give) ? ['give' as const] : []), ...(on(input.guest) ? ['guest' as const] : [])];
  return errors.length ? { ok: false, errors } : { ok: true, value: { alt, face, uses } };
}

export const parseUses = (raw: string): ('give' | 'guest')[] =>
  raw.split(',').filter((u): u is 'give' | 'guest' => u === 'give' || u === 'guest');
