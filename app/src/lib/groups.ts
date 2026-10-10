import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../db/schema.ts';
/* TYPE-only, like lib/archive.ts, so this stays unit-testable in plain node. */
import type { Db } from '../db';
import { chunks } from './archive.ts';

/**
 * Putting many people into a texting group at once, from the People tab's ticks.
 *
 * The per-person group boxes on a profile stay; this is for building a group in
 * one go — search a surname, tick the family, add; search the next.
 *
 * ADDING IS HARMLESS AND SO IS NOT CONFIRMED. Somebody already in the group is
 * left as they are (the pair is unique), nobody leaves any other group, and a
 * wrong add is undone by ticking them and removing. Removing many at once IS
 * confirmed, on the page, the same two-step way archiving is.
 */

export const MAX_GROUP_NAME = 80;

export type GroupTarget = { kind: 'existing'; id: number } | { kind: 'new'; name: string };

/**
 * Which group the bar means: one chosen from the dropdown, OR a new one typed
 * into the name box. Both at once is refused rather than guessed — adding forty
 * people to the wrong list is exactly the mistake this should not make easy.
 */
export function parseGroupTarget(
  choice: unknown, newName: unknown,
): { target: GroupTarget } | { error: string } {
  const c = typeof choice === 'string' ? choice.trim() : '';
  const n = typeof newName === 'string' ? newName.trim().replace(/\s+/g, ' ') : '';
  if (c && n) return { error: 'Choose a group or type a new group name, not both.' };
  if (n) {
    if (n.length > MAX_GROUP_NAME) return { error: `Keep the group name under ${MAX_GROUP_NAME} characters.` };
    return { target: { kind: 'new', name: n } };
  }
  if (/^[1-9][0-9]{0,8}$/.test(c)) return { target: { kind: 'existing', id: Number(c) } };
  return { error: 'Choose a group to add them to, or type a name for a new one.' };
}

/** The id of the group the target means, creating a new one if it has to. A
 *  typed name that matches an existing group (ignoring case) USES that group
 *  rather than failing on the unique name. Null if a chosen id does not exist. */
export async function resolveGroup(db: Db, target: GroupTarget): Promise<number | null> {
  if (target.kind === 'existing') {
    const [g] = await db.select({ id: schema.groups.id }).from(schema.groups)
      .where(eq(schema.groups.id, target.id)).limit(1);
    return g?.id ?? null;
  }
  const findByName = async () => (await db.select({ id: schema.groups.id }).from(schema.groups)
    .where(sql`lower(${schema.groups.name}) = lower(${target.name})`).limit(1))[0]?.id ?? null;
  const existing = await findByName();
  if (existing) return existing;
  await db.insert(schema.groups)
    .values({ name: target.name, createdAt: new Date().toISOString() })
    .onConflictDoNothing();
  return findByName();
}

/** Of these ids, the people who are not archived — an archived person is off
 *  every texting audience, and must not quietly rejoin one through a group. */
export async function activePeople(db: Db, ids: number[]): Promise<number[]> {
  const out: number[] = [];
  for (const part of chunks(ids)) {
    const rows = await db.select({ id: schema.people.id }).from(schema.people)
      .where(and(inArray(schema.people.id, part), eq(schema.people.archived, false)));
    out.push(...rows.map((r) => r.id));
  }
  return out;
}

/** How many people are in a group. */
export async function memberCount(db: Db, groupId: number): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)` }).from(schema.peopleGroups)
    .where(eq(schema.peopleGroups.groupId, groupId));
  return Number(r?.n ?? 0);
}

/** Add, skipping anyone already in. Two values bound per row, so 45 rows a
 *  statement keeps each under D1's limit. */
export async function addToGroup(db: Db, groupId: number, personIds: number[]): Promise<void> {
  for (const part of chunks(personIds, 45)) {
    await db.insert(schema.peopleGroups)
      .values(part.map((personId) => ({ personId, groupId })))
      .onConflictDoNothing();
  }
}

/** Take people out of ONE group. Nobody leaves the church, or any other group. */
export async function removeFromGroup(db: Db, groupId: number, personIds: number[]): Promise<void> {
  for (const part of chunks(personIds)) {
    await db.delete(schema.peopleGroups)
      .where(and(eq(schema.peopleGroups.groupId, groupId), inArray(schema.peopleGroups.personId, part)));
  }
}
