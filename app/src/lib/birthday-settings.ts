/**
 * Automatic birthday texts.
 *
 * NOT a schedule. the pastor's call, and it is the right one: a birthday text is not
 * something you sit down and arrange, it is a standing arrangement that either
 * runs or does not. Putting it on the scheduling screen made it look like a job
 * you had to remember to set up each year, which is exactly backwards.
 *
 * So it lives in app_settings — one switch, one time of day, one message — and
 * the runner checks it every day without anybody creating anything.
 *
 * Same shape as getInviteTemplate in directory.ts: a missing or unusable stored
 * value degrades to the built-in wording rather than to silence. Reading is not
 * the moment to discover somebody saved something broken; by then a text is
 * about to go out.
 */
import { eq } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../db';
import { parseHhmm } from './schedules';

const KEY_ON = 'birthday_texts_on';
const KEY_TIME = 'birthday_texts_time';
const KEY_BODY = 'birthday_texts_body';

/**
 * Deliberately one GSM-7 segment — no curly apostrophe, no em dash. A smart
 * quote here would silently make every birthday text cost three times as much,
 * which is the trap the singing reminder documents.
 */
export const DEFAULT_BIRTHDAY_BODY =
  'Happy birthday, {first}! We thank God for you today and we are praying for you. '
  + '- [Your Church Name]';

/** 9am. Early enough to be a birthday greeting, late enough not to wake anyone. */
export const DEFAULT_BIRTHDAY_TIME = '09:00';

export interface BirthdaySettings { on: boolean; time: string; body: string }

export async function getBirthdaySettings(env: { DB: D1Database }): Promise<BirthdaySettings> {
  const out: BirthdaySettings = { on: false, time: DEFAULT_BIRTHDAY_TIME, body: DEFAULT_BIRTHDAY_BODY };
  try {
    const rows = await getDb(env).select().from(schema.appSettings);
    const get = (k: string) => rows.find((r) => r.key === k)?.value;
    out.on = get(KEY_ON) === '1';
    const t = get(KEY_TIME);
    if (t && parseHhmm(t) !== null) out.time = t;
    const b = get(KEY_BODY);
    if (b && b.trim()) out.body = b.trim();
  } catch { /* defaults, and OFF — never text the church because a read failed */ }
  return out;
}

/** Returns a reason it was refused, or null when saved. */
export async function setBirthdaySettings(
  env: { DB: D1Database }, s: BirthdaySettings, by: string,
): Promise<string | null> {
  if (parseHhmm(s.time) === null) return 'Pick a time of day.';
  const body = s.body.trim();
  if (!body) return 'The birthday message is empty.';
  if (!/\{first\}|\{name\}/i.test(body)) {
    // Not pedantry: a birthday text with no name reads like a bulk mailout, and
    // the whole point is that it is addressed to the person.
    return 'Include {first} so each person is greeted by name.';
  }
  const db = getDb(env);
  for (const [key, value] of [[KEY_ON, s.on ? '1' : '0'], [KEY_TIME, s.time], [KEY_BODY, body]]) {
    await db.insert(schema.appSettings)
      .values({ key, value, updatedAt: nowIso(), updatedBy: by })
      .onConflictDoUpdate({ target: schema.appSettings.key,
                            set: { value, updatedAt: nowIso(), updatedBy: by } });
  }
  return null;
}
