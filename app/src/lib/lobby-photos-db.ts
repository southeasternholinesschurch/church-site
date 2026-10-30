/**
 * Uploaded lobby photographs — the database and R2 half. The rules are pure
 * and tested, in lib/lobby-photos.ts.
 *
 * Stored in the PHOTOS bucket under `lobby-photo/`, served publicly BY ID only
 * (/api/lobby/photo/{id}), so — as with hero frames — a request can never name
 * its way to a member portrait in the same bucket.
 */
import { desc, eq } from 'drizzle-orm';
import { schema, type Db } from '../db';
import type { UploadedPhoto } from './lobby';
import { parseUses } from './lobby-photos';

type Row = typeof schema.lobbyPhotos.$inferSelect;

export const photoUrl = (r: Pick<Row, 'id' | 'imageKey'>) =>
  `/api/lobby/photo/${r.id}?v=${r.imageKey.split('/').pop()!.slice(0, 8)}`;

export const toUploaded = (r: Row): UploadedPhoto & { active: boolean } =>
  ({ id: r.id, src: photoUrl(r), alt: r.alt, face: r.face, uses: parseUses(r.uses), active: r.active });

/** Switched-on uploads, oldest first, for the feed. */
export async function photosForFeed(db: Db): Promise<UploadedPhoto[]> {
  const rows = await db.select().from(schema.lobbyPhotos).where(eq(schema.lobbyPhotos.active, true))
    .orderBy(schema.lobbyPhotos.id);
  return rows.map((r) => { const { active: _, ...u } = toUploaded(r); return u; });
}

/** Every upload, newest first, for the Lobby tab. */
export async function allPhotos(db: Db) {
  const rows = await db.select().from(schema.lobbyPhotos).orderBy(desc(schema.lobbyPhotos.id));
  return rows.map(toUploaded);
}
