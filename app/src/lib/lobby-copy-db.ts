/**
 * The Lobby tab's two rows in app_settings — the database half:
 *
 *   lobby_copy      the screen's words, only those somebody changed
 *                   (rules: lib/lobby-copy.ts)
 *   lobby_settings  pace, switched-off scene types, the notice
 *                   (rules: lib/lobby-settings.ts)
 */
import { eq } from 'drizzle-orm';
import { schema, type Db } from '../db';
import { parseCopy } from './lobby-copy';
import { parseSettings, type LobbySettings } from './lobby-settings';

const KEY = 'lobby_copy';
const SETTINGS_KEY = 'lobby_settings';

export async function getLobbyCopy(db: Db): Promise<Record<string, string>> {
  try {
    const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, KEY)).limit(1);
    return parseCopy(row?.value);
  } catch { return {}; }   // a failed read is the default words, never a blank screen
}

export async function setLobbyCopy(db: Db, copy: Record<string, string>, by: string): Promise<void> {
  const value = JSON.stringify(copy);
  const updatedAt = new Date().toISOString();
  await db.insert(schema.appSettings).values({ key: KEY, value, updatedAt, updatedBy: by })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt, updatedBy: by } });
}

export async function getLobbySettings(db: Db): Promise<LobbySettings> {
  try {
    const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, SETTINGS_KEY)).limit(1);
    return parseSettings(row?.value);
  } catch { return parseSettings(null); }
}

export async function setLobbySettings(db: Db, settings: LobbySettings, by: string): Promise<void> {
  const value = JSON.stringify(settings);
  const updatedAt = new Date().toISOString();
  await db.insert(schema.appSettings).values({ key: SETTINGS_KEY, value, updatedAt, updatedBy: by })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt, updatedBy: by } });
}
