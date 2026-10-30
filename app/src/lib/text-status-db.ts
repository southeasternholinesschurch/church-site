/**
 * Recording what became of a text: the database half. The rules are in
 * lib/text-status.ts.
 *
 * Two ways a status arrives, one place it is written:
 *   - Twilio's delivery report, posted to /api/sms/webhook.
 *   - checkStuckTexts, which asks Twilio about any text whose report never came.
 *     Run by the five-minute cron (api/sms/run-due.ts).
 */
import { and, desc, eq, gte, inArray, lte, isNotNull } from 'drizzle-orm';
import { schema, type Db } from '../db';
import { fetchMessageStatus, type SmsEnv } from './sms';
import { CHECK_AFTER_MINUTES, IN_FLIGHT, isFailure, movesForward, outcomeOf } from './text-status';

/**
 * Write a status for every log row carrying this SID (a family's shared phone
 * has one row per person), and reopen the queued reminder behind a failure.
 *
 * The reopening is why this is shared rather than copied: Twilio ACCEPTING a
 * message is not a phone receiving it. A reminder recorded as sent and then
 * dropped by the carrier must read as failed, or the app believes somebody was
 * told when they were not (2026-09-01: both singing reminders dropped with
 * error 30034, and they would have stayed "sent" for ever).
 */
export async function recordDeliveryStatus(
  db: Db, sid: string, status: string, errorCode: string | null,
): Promise<void> {
  const rows = await db.select({ status: schema.messageLog.status, smId: schema.messageLog.scheduledMessageId })
    .from(schema.messageLog).where(eq(schema.messageLog.twilioSid, sid)).limit(1);
  // Never backwards: see movesForward in lib/text-status.ts. A report about a
  // text we have no row for (yet) is dropped; the checker settles it later.
  if (!rows[0] || !movesForward(rows[0].status, status)) return;

  await db.update(schema.messageLog)
    .set({ status, errorCode })
    .where(eq(schema.messageLog.twilioSid, sid));

  if (isFailure(status)) {
    const smId = rows[0].smId;
    if (smId) {
      await db.update(schema.scheduledMessages)
        .set({ status: 'failed',
               note: `Carrier did not deliver it${errorCode ? ` (error ${errorCode})` : ''}` })
        .where(eq(schema.scheduledMessages.id, smId));
    }
  }
}

export interface CheckResult { checked: number; updated: number; errors: number }

/** How far back to look. Twilio keeps message records far longer than this. */
const LOOK_BACK_DAYS = 60;

/**
 * Ask Twilio about texts whose delivery report never arrived.
 *
 * WHY: on 2026-10-21, 303 texts from September and October were still marked
 * "queued", spread across 39 people who had all received other texts. Every
 * one had been accepted by Twilio; the report saying what happened next had
 * simply not been recorded. Without asking, "did it arrive?" had no answer.
 *
 * `budget` is how many Twilio calls this run may make. A Worker request may
 * make 50 outbound calls in all, and the queue drain spends up to 40, so the
 * cron passes what is left. Newest first, so today's texts are settled before
 * last month's backlog.
 */
export async function checkStuckTexts(env: SmsEnv & { DB: D1Database }, db: Db, budget: number): Promise<CheckResult> {
  const out: CheckResult = { checked: 0, updated: 0, errors: 0 };
  if (budget <= 0) return out;

  const now = Date.now();
  const before = new Date(now - CHECK_AFTER_MINUTES * 60_000).toISOString();
  const since = new Date(now - LOOK_BACK_DAYS * 86_400_000).toISOString();

  const rows = await db.select({ sid: schema.messageLog.twilioSid, createdAt: schema.messageLog.createdAt })
    .from(schema.messageLog)
    .where(and(
      eq(schema.messageLog.direction, 'out'),
      isNotNull(schema.messageLog.twilioSid),
      inArray(schema.messageLog.status, [...IN_FLIGHT]),
      lte(schema.messageLog.createdAt, before),
      gte(schema.messageLog.createdAt, since),
    ))
    .orderBy(desc(schema.messageLog.createdAt))
    .limit(budget * 3);                      // shared phones repeat a SID

  const seen = new Set<string>();
  for (const r of rows) {
    if (out.checked >= budget) break;
    if (!r.sid || seen.has(r.sid)) continue;
    seen.add(r.sid);
    out.checked++;

    const answer = await fetchMessageStatus(env, r.sid);
    if (!answer.ok) { out.errors++; continue; }
    const ageHours = (now - Date.parse(r.createdAt)) / 3_600_000;
    const outcome = outcomeOf(answer, ageHours);
    if (!outcome) continue;
    await recordDeliveryStatus(db, r.sid, outcome.status, outcome.errorCode);
    out.updated++;
  }
  return out;
}

/** The cron's heartbeat, so the troubleshooting page can tell a stopped cron from a quiet one. */
export const HEARTBEAT_KEY = 'sms_cron_last_run';

export async function beat(db: Db, iso: string): Promise<void> {
  await db.insert(schema.appSettings).values({ key: HEARTBEAT_KEY, value: iso, updatedAt: iso })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: iso, updatedAt: iso } });
}
