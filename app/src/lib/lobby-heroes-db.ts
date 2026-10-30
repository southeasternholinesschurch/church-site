/**
 * Hero frames — the database and R2 half. The rules (what is valid, when a
 * frame is due, how it is drawn) are pure and tested, in lib/lobby-heroes.ts.
 *
 * The graphics share the PHOTOS bucket with member portraits, under their own
 * `lobby-hero/` prefix. That is safe only because nothing ever serves a key
 * taken from a request: the public route looks a hero up BY ID and serves the
 * key stored on that row, and only rows of this table carry `lobby-hero/` keys.
 * A request cannot name its way into `people/`.
 */
import { and, desc, eq, gte, isNull, or } from 'drizzle-orm';
import { schema, type Db } from '../db';
import type { LobbyHero } from './lobby-heroes';
import { addDays, clockParts } from './lobby';

type Row = typeof schema.lobbyHeroes.$inferSelect;

/** The public address of a frame's graphic. The key's tail is the cache-buster:
 *  a replaced graphic gets a new key, so a new URL. */
export const heroImageUrl = (r: Pick<Row, 'id' | 'imageKey'>) =>
  `/api/lobby/hero/${r.id}?v=${r.imageKey.split('/').pop()!.slice(0, 8)}`;

export function toHero(r: Row): LobbyHero {
  return {
    id: r.id, image: heroImageUrl(r), kicker: r.kicker, title: r.title, subtitle: r.subtitle,
    corner: r.corner, tone: r.tone, accent: r.accent, titleStyle: r.titleStyle, shade: r.shade,
    startsOn: r.startsOn, endsOn: r.endsOn,
  };
}

/**
 * The frames the screen may need: switched on, and not finished before
 * yesterday (a day of slack for a box whose clock runs ahead of the church's).
 * Which of them is due TODAY is the screen's call, so a `?at=` preview works.
 */
export async function heroesForFeed(db: Db): Promise<LobbyHero[]> {
  const yesterday = addDays(clockParts(new Date()).date, -1);
  const rows = await db.select().from(schema.lobbyHeroes)
    .where(and(eq(schema.lobbyHeroes.active, true),
      or(isNull(schema.lobbyHeroes.endsOn), gte(schema.lobbyHeroes.endsOn, yesterday))))
    .orderBy(desc(schema.lobbyHeroes.updatedAt));
  return rows.map(toHero);
}

/** Every frame, newest first, for the dashboard. */
export async function allHeroes(db: Db): Promise<(LobbyHero & { active: boolean })[]> {
  const rows = await db.select().from(schema.lobbyHeroes).orderBy(desc(schema.lobbyHeroes.updatedAt));
  return rows.map((r) => ({ ...toHero(r), active: r.active }));
}
