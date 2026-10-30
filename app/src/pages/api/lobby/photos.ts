import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../db';
import { LOBBY_PHOTOS } from '../../../lib/lobby';
import { validatePhoto } from '../../../lib/lobby-photos';
import { toUploaded } from '../../../lib/lobby-photos-db';
import { getLobbySettings, setLobbySettings } from '../../../lib/lobby-copy-db';
import { MAX_UPLOAD_BYTES, sniffImage } from '../../../lib/photos';

export const prerender = false;

/**
 * STAFF: the Lobby tab's Photos card. Upload, describe, switch on and off,
 * delete — and switch the built-in photographs on and off, which are not rows
 * but names in the lobby settings.
 *
 * Behind the staff gate (not under the public '/api/lobby/photo/'). The photo
 * arrives already resized and re-encoded by the editor; it is still checked on
 * its real bytes, because whatever is stored is served to a public screen.
 */
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const user = locals.user!;
  const db = getDb(env);
  const form = await request.formData();
  const action = String(form.get('action') ?? '');
  const at = new Date().toISOString();

  if (action === 'toggle-builtin') {
    const key = String(form.get('key') ?? '');
    if (!LOBBY_PHOTOS.some((p) => p.file === key)) return json({ ok: false, errors: ['No such photo.'] }, 404);
    const s = await getLobbySettings(db);
    const hiddenPhotos = s.hiddenPhotos.includes(key) ? s.hiddenPhotos.filter((k) => k !== key) : [...s.hiddenPhotos, key];
    await setLobbySettings(db, { ...s, hiddenPhotos }, user.email);
    return json({ ok: true, on: !hiddenPhotos.includes(key) });
  }

  if (!env.PHOTOS) return json({ ok: false, errors: ['Photo storage is not switched on here.'] }, 503);
  const id = Number(form.get('id') ?? 0) || null;
  const existing = id ? (await db.select().from(schema.lobbyPhotos).where(eq(schema.lobbyPhotos.id, id)).limit(1))[0] : undefined;
  if (id && !existing) return json({ ok: false, errors: ['That photo no longer exists.'] }, 404);

  if (action === 'delete' && existing) {
    await db.delete(schema.lobbyPhotos).where(eq(schema.lobbyPhotos.id, existing.id));
    await env.PHOTOS.delete(existing.imageKey);
    return json({ ok: true });
  }
  if (action === 'toggle' && existing) {
    const [row] = await db.update(schema.lobbyPhotos).set({ active: !existing.active, updatedAt: at, updatedBy: user.email })
      .where(eq(schema.lobbyPhotos.id, existing.id)).returning();
    return json({ ok: true, photo: toUploaded(row!) });
  }

  // Save: a new upload, or new words for an existing one.
  const checked = validatePhoto({ alt: form.get('alt'), face: form.get('face'), give: form.get('give'), guest: form.get('guest') });
  if (!checked.ok) return json({ ok: false, errors: checked.errors }, 400);
  const values = { alt: checked.value.alt, face: checked.value.face, uses: checked.value.uses.join(','), updatedAt: at, updatedBy: user.email };

  if (existing) {
    const [row] = await db.update(schema.lobbyPhotos).set(values).where(eq(schema.lobbyPhotos.id, existing.id)).returning();
    return json({ ok: true, photo: toUploaded(row!) });
  }
  const file = form.get('image');
  if (!(file instanceof File) || !file.size) return json({ ok: false, errors: ['Choose a photo.'] }, 400);
  if (file.size > MAX_UPLOAD_BYTES) return json({ ok: false, errors: ['That photo is over 8 MB.'] }, 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffImage(bytes);
  if (!mime) return json({ ok: false, errors: ['That file is not a JPEG, PNG or WebP image.'] }, 400);
  const imageKey = `lobby-photo/${crypto.randomUUID()}.${mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'}`;
  await env.PHOTOS.put(imageKey, bytes, { httpMetadata: { contentType: mime } });
  const [row] = await db.insert(schema.lobbyPhotos).values({ ...values, imageKey, active: true, createdAt: at }).returning();
  return json({ ok: true, photo: toUploaded(row!) });
};
