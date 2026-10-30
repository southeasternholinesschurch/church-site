/**
 * "Has anything on the lobby screen changed?", answered with one small query.
 *
 * WHY: building the whole feed (bulletin, birthdays, singing sheet, sign-ups,
 * a dozen QR codes) costs 26-87ms of CPU, measured 2026-10-24, and the free
 * Workers plan allows 10. The TV asked for it every two minutes, all day, for
 * a bulletin that changes about once a week. The pastor, 2026-10-24: "Once that
 * information is pushed out through the bulletin, the screen needs to update."
 *
 * So the screen sends the stamp it already has, and the feed answers "no
 * change" (204) unless this stamp differs. The stamp is the count and latest
 * updated_at of each table the screen shows, so publishing a bulletin, opening
 * or closing a sign-up sheet, a change on /singing, or any change on the Lobby
 * tab shows within one poll. Counts as well as dates, so a DELETED row changes
 * it too.
 *
 * Not covered, on purpose: the website's events and sermon, a birthday edited
 * on someone's page, and the Google Sheet (only read while the singing table is
 * empty; see singing-db.ts). The screen fetches the full feed once an hour
 * regardless (FULL_REFRESH_MS in lib/lobby.ts), which is soon enough for those.
 *
 * Raw SQL: if any of these tables changes shape, grep for it here too.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../db';
import { churchToday } from './services';
import { stampOf } from './lobby';

export async function lobbyStamp(db: Db): Promise<string> {
  const [row] = await db.all(sql`
    SELECT
      (SELECT count(*) || '.' || coalesce(max(updated_at), '') FROM bulletins WHERE status = 'published') AS b,
      (SELECT count(*) || '.' || coalesce(max(updated_at), '') FROM signup_sheets) AS s,
      (SELECT count(*) || '.' || coalesce(max(updated_at), '') FROM lobby_photos) AS p,
      (SELECT count(*) || '.' || coalesce(max(updated_at), '') FROM lobby_heroes) AS h,
      (SELECT count(*) || '.' || coalesce(max(updated_at), '') FROM singing_schedule) AS g,
      (SELECT group_concat(key || '@' || updated_at) FROM app_settings
        WHERE key IN ('lobby_copy', 'lobby_settings')) AS c`) as Record<string, unknown>[];
  // Today's date too: which bulletin is "this Sunday's", and which sign-up
  // sheets have closed, both turn over at midnight with nothing written.
  return stampOf([churchToday(), row?.b, row?.s, row?.p, row?.h, row?.g, row?.c].map((x) => String(x ?? '')).join('|'));
}
