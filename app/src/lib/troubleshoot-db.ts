/**
 * What the troubleshooting page (/website/troubleshooting) and the dashboard's
 * warning read: is texting working, and what did not arrive.
 *
 * The pastor, 2026-10-21: "some of my texts have not been going out ... we probably
 * ought to build a troubleshooting page ... so I can see notifications if texts
 * don't go out." Texts first; the rest of the app can add sections later.
 *
 * Raw SQL for the grouped reads, so: if message_log, scheduled_messages or
 * app_settings change shape, grep for them here too (astro check cannot see
 * inside these strings).
 */
import { sql } from 'drizzle-orm';
import { schema, type Db } from '../db';
import { HEARTBEAT_KEY } from './text-status-db';
import { CHECK_AFTER_MINUTES } from './text-status';

/** Longer than this without a cron run means the cron has stopped. It runs every 5 minutes. */
export const CRON_LATE_MINUTES = 20;
/** A queued text this far past its time has not been sent. */
export const OVERDUE_MINUTES = 15;

export interface TextHealth {
  /** Minutes since the five-minute cron last ran; null if it has never stamped one. */
  cronMinutesAgo: number | null;
  /** When it last ran, as stamped. */
  cronLastRun: string | null;
  /** Queued texts whose time has passed by more than OVERDUE_MINUTES. */
  overdue: number;
  /** Texts Twilio has not reported on yet, older than CHECK_AFTER_MINUTES. */
  waiting: number;
  /** Texts that did not arrive in the last `days` days. */
  notDelivered: number;
}

const one = async <T>(db: Db, q: ReturnType<typeof sql>): Promise<T | undefined> =>
  (await db.all(q))[0] as T | undefined;

/**
 * `since`, when given, counts only what happened after it: the dashboard passes
 * the moment this person last opened the troubleshooting page, so an alert
 * they have already looked at does not keep coming back (the pastor, 2026-10-21).
 */
export async function textHealth(db: Db, days = 7, since?: string | null): Promise<TextHealth> {
  const now = Date.now();
  const beat = await one<{ value: string }>(db,
    sql`SELECT value FROM app_settings WHERE key = ${HEARTBEAT_KEY}`);
  const cronMinutesAgo = beat ? Math.round((now - Date.parse(beat.value)) / 60_000) : null;

  const overdueBefore = new Date(now - OVERDUE_MINUTES * 60_000).toISOString();
  const waitingBefore = new Date(now - CHECK_AFTER_MINUTES * 60_000).toISOString();
  const windowStart = new Date(now - days * 86_400_000).toISOString();
  const from = since && since > windowStart ? since : windowStart;
  const queuedAfter = since ?? '';

  const counts = await one<{ overdue: number; waiting: number; bad: number }>(db, sql`
    SELECT
      (SELECT count(*) FROM scheduled_messages
        WHERE status = 'pending' AND source = 'schedule' AND send_at <= ${overdueBefore}
          AND send_at > ${queuedAfter}) AS overdue,
      (SELECT count(DISTINCT twilio_sid) FROM message_log
        WHERE direction = 'out' AND status IN ('accepted','scheduled','queued','sending')
          AND created_at <= ${waitingBefore}) AS waiting,
      (SELECT count(DISTINCT coalesce(twilio_sid, id)) FROM message_log
        WHERE direction = 'out' AND status IN ('undelivered','failed')
          AND created_at >= ${from}) AS bad`);

  return {
    cronMinutesAgo,
    cronLastRun: beat?.value ?? null,
    overdue: Number(counts?.overdue ?? 0),
    waiting: Number(counts?.waiting ?? 0),
    notDelivered: Number(counts?.bad ?? 0),
  };
}

export interface SendGroup {
  hour: string;          // ISO, to the hour: one broadcast, even when it went out in several calls
  body: string;
  handsets: number;
  delivered: number;
  sent: number;
  bad: number;
  waiting: number;
  unknown: number;
}

/**
 * Every outgoing text of the last `days` days, a row per message: the same
 * words sent within the same hour are one broadcast. Counted per handset (per
 * SID), so a family sharing a phone is one text, as it was billed.
 */
export async function recentSends(db: Db, days = 30): Promise<SendGroup[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return (await db.all(sql`
    SELECT substr(created_at, 1, 13) AS hour, body,
           count(DISTINCT coalesce(twilio_sid, id)) AS handsets,
           count(DISTINCT CASE WHEN status IN ('delivered','read') THEN twilio_sid END) AS delivered,
           count(DISTINCT CASE WHEN status = 'sent' THEN twilio_sid END) AS sent,
           count(DISTINCT CASE WHEN status IN ('undelivered','failed') THEN coalesce(twilio_sid, id) END) AS bad,
           count(DISTINCT CASE WHEN status IN ('accepted','scheduled','queued','sending') THEN twilio_sid END) AS waiting,
           count(DISTINCT CASE WHEN status = 'unconfirmed' THEN twilio_sid END) AS unknown
    FROM message_log
    WHERE direction = 'out' AND created_at >= ${since}
    GROUP BY hour, body
    ORDER BY hour DESC
    LIMIT 60`)) as SendGroup[];
}

export interface Undelivered {
  phone: string;
  personId: number | null;
  name: string | null;
  times: number;
  last: string;
  errorCode: string | null;
  /** How many texts reached this number in the same period: a number that never works is a different problem from one that failed once. */
  deliveredToo: number;
}

/** The numbers that did not get a text in the last `days` days, worst first. */
export async function undelivered(db: Db, days = 30): Promise<Undelivered[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return (await db.all(sql`
    SELECT m.phone_e164 AS phone, max(m.person_id) AS personId,
           max(p.first_name || ' ' || p.last_name) AS name,
           count(DISTINCT coalesce(m.twilio_sid, m.id)) AS times,
           max(m.created_at) AS last,
           max(m.error_code) AS errorCode,
           (SELECT count(*) FROM message_log d
             WHERE d.phone_e164 = m.phone_e164 AND d.direction = 'out'
               AND d.status IN ('delivered','read') AND d.created_at >= ${since}) AS deliveredToo
    FROM message_log m
    LEFT JOIN people p ON p.id = m.person_id
    WHERE m.direction = 'out' AND m.status IN ('undelivered','failed') AND m.created_at >= ${since}
    GROUP BY m.phone_e164
    ORDER BY times DESC, last DESC
    LIMIT 50`)) as Undelivered[];
}

export interface QueueProblem { sendAt: string; status: string; note: string | null; n: number }

/** Reminders and scheduled texts that were skipped or failed, with the reason recorded at the time. */
export async function queueProblems(db: Db, days = 30): Promise<QueueProblem[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  return (await db.all(sql`
    SELECT substr(send_at, 1, 10) AS sendAt, status, note, count(*) AS n
    FROM scheduled_messages
    WHERE status IN ('failed','skipped') AND send_at >= ${since}
    GROUP BY sendAt, status, note
    ORDER BY sendAt DESC
    LIMIT 40`)) as QueueProblem[];
}

/* ---------------------------------------------------------- seen alerts -- */

const seenKey = (staffId: number) => `troubleshoot_seen:${staffId}`;

/** When this person last opened the troubleshooting page, or null. */
export async function lastSeen(db: Db, staffId: number): Promise<string | null> {
  const row = await one<{ value: string }>(db,
    sql`SELECT value FROM app_settings WHERE key = ${seenKey(staffId)}`);
  return row?.value ?? null;
}

/** Opening the page counts as having seen everything on it. */
export async function markSeen(db: Db, staffId: number, iso: string): Promise<void> {
  await db.insert(schema.appSettings).values({ key: seenKey(staffId), value: iso, updatedAt: iso })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: iso, updatedAt: iso } });
}
