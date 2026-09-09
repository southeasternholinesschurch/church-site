/**
 * Reading the singing schedule for the bulletin.
 *
 * The I/O half — roster.ts stays pure so it can be tested without a network.
 *
 * NEVER THROWS, and never returns a partial answer. A sheet that is slow,
 * moved, unshared or malformed yields null, and the bulletin simply prints no
 * singing section. The bulletin is handed out on paper on a Sunday morning;
 * it must not depend on a Google Sheet being reachable at the moment somebody
 * hits print.
 */
import { parseRosterDetailed, singersFor, type SingingForBulletin } from './roster';

/** Short: this sits on the path of a page a volunteer is waiting for. */
const TIMEOUT_MS = 6000;

export async function singingForBulletin(
  env: { REMINDER_SHEET_CSV_URL?: string }, serviceDate: string,
): Promise<SingingForBulletin | null> {
  const url = env.REMINDER_SHEET_CSV_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      // The whole point is that edits to the sheet show up. A cached copy
      // would make this feature quietly wrong rather than visibly broken.
      headers: { 'cache-control': 'no-cache' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return singersFor(parseRosterDetailed(await res.text()), serviceDate);
  } catch {
    return null;
  }
}
