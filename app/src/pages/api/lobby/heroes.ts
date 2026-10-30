import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb, schema } from '../../../db';
import { validateHero } from '../../../lib/lobby-heroes';
import { toHero } from '../../../lib/lobby-heroes-db';
import { MAX_UPLOAD_BYTES, sniffImage } from '../../../lib/photos';

export const prerender = false;

/**
 * STAFF: create, edit, switch off and delete lobby hero frames. Used by the
 * editor dialog on the dashboard.
 *
 * Behind the staff gate like everything not listed in lib/public-paths.ts —
 * and deliberately NOT under '/api/lobby/hero/', which is public. An editor
 * may use it; a children's volunteer may not (permissions.ts allowlists them
 * to /kids).
 *
 * The graphic arrives already cropped to 16:9 and resized by the editor in the
 * browser (no image library runs on a Worker). It is still checked here on its
 * real bytes, because whatever is stored is served to a public screen.
 */
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const user = locals.user!;
  if (!env.PHOTOS) return json({ ok: false, errors: ['Photo storage is not switched on here.'] }, 503);
  const db = getDb(env);
  const form = await request.formData();
  const action = String(form.get('action') ?? 'save');
  const id = Number(form.get('id') ?? 0) || null;
  const at = new Date().toISOString();

  const existing = id
    ? (await db.select().from(schema.lobbyHeroes).where(eq(schema.lobbyHeroes.id, id)).limit(1))[0]
    : undefined;
  if (id && !existing) return json({ ok: false, errors: ['That hero frame no longer exists.'] }, 404);

  if (action === 'delete' && existing) {
    await db.delete(schema.lobbyHeroes).where(eq(schema.lobbyHeroes.id, existing.id));
    await env.PHOTOS.delete(existing.imageKey);
    return json({ ok: true });
  }
  if (action === 'toggle' && existing) {
    const [row] = await db.update(schema.lobbyHeroes)
      .set({ active: !existing.active, updatedAt: at, updatedBy: user.email })
      .where(eq(schema.lobbyHeroes.id, existing.id)).returning();
    return json({ ok: true, hero: { ...toHero(row!), active: row!.active } });
  }

  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'));
  const checked = validateHero(fields);
  if (!checked.ok) return json({ ok: false, errors: checked.errors }, 400);

  // A new graphic: required for a new frame, optional when editing one.
  const file = form.get('image');
  let imageKey = existing?.imageKey;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_UPLOAD_BYTES) return json({ ok: false, errors: ['That graphic is over 8 MB.'] }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffImage(bytes);
    if (!mime) return json({ ok: false, errors: ['That file is not a JPEG, PNG or WebP image.'] }, 400);
    const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
    imageKey = `lobby-hero/${crypto.randomUUID()}.${ext}`;
    await env.PHOTOS.put(imageKey, bytes, { httpMetadata: { contentType: mime } });
  }
  if (!imageKey) return json({ ok: false, errors: ['Choose a graphic for the frame.'] }, 400);

  // Switched on unless the editor says otherwise.
  const active = form.get('active') === null ? (existing?.active ?? true) : form.get('active') === '1';
  const values = { ...checked.value, active, imageKey, updatedAt: at, updatedBy: user.email };
  const [row] = existing
    ? await db.update(schema.lobbyHeroes).set(values).where(eq(schema.lobbyHeroes.id, existing.id)).returning()
    : await db.insert(schema.lobbyHeroes).values({ ...values, createdAt: at }).returning();
  // The old graphic goes once the new one is safely on the row.
  if (existing && existing.imageKey !== imageKey) await env.PHOTOS.delete(existing.imageKey);
  return json({ ok: true, hero: { ...toHero(row!), active: row!.active } });
};
