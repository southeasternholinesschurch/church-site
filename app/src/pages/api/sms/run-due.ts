import type { APIRoute } from 'astro';
import { getDb, schema, nowIso } from '../../../db';
import { parseRoster, dueSunday, reminderKey, SINGING_REMINDER } from '../../../lib/roster';
import { matchNames, alreadySent } from '../../../lib/roster-db';
import { sendOne, smsConfigured, countSegments } from '../../../lib/sms';
import { secretsMatch } from '../../../lib/constant-time';
import { expandDue, drainQueue } from '../../../lib/schedule-runner';

export const prerender = false;

/**
 * Everything the cron Worker wakes us up to do.
 *
 * Three jobs, in order:
 *   1. expand any message_schedules that are due into per-recipient queue rows
 *   2. send what is queued, up to the per-run ceiling
 *   3. the Monday singing reminder, from the roster sheet (hourly only)
 *
 * Frequent rather than exact on purpose: a cron that fires once at the moment
 * something is due misses it entirely if that one run fails. Running every five
 * minutes and deciding for itself what is due means a missed run costs five
 * minutes. The roster job is gated to ?roster=1 so the sheet is still fetched
 * only once an hour rather than 288 times a day.
 *
 * Idempotent by construction throughout. Every queued text carries a unique
 * source_key, and the unique index on that column is what actually prevents a
 * second send — not any check in this file. Running this twenty times sends
 * each person one text.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;

  // Shared secret, not a session — the caller is a Worker, not a person.
  //
  // Compared in constant time over SHA-256 digests, so neither how much of the
  // secret was right nor how long it was can be read off the response time.
  // This endpoint can spend money: it triggers real Twilio sends.
  //
  // Nothing about the failure is logged. The presented value must never reach
  // the Worker's logs — Cloudflare's log stream is readable by anyone with
  // dashboard access, and a secret in it is a secret to rotate.
  if (!(await secretsMatch(request.headers.get('x-cron-secret'), env.SMS_CRON_SECRET))) {
    return json({ error: 'unauthorised' }, 401);
  }

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';

  // --- schedules: expand what is due, then send what is queued -------------
  // Runs on every tick. Expansion re-reads the audience each time, which is
  // what lets a birthday added to the directory this morning go out this
  // morning rather than next year.
  const schedules = dry ? null : await expandDue(env);
  const drained = dry ? null : await drainQueue(env);

  // The roster sheet is fetched only when asked, so raising the cron frequency
  // did not multiply requests to Google by 12.
  if (url.searchParams.get('roster') !== '1') {
    return json({ ran: true, schedules, drained });
  }

  const due = dueSunday();
  if (!due) return json({ ran: true, schedules, drained, sent: 0, note: 'not a send window' });

  const sheet = env.REMINDER_SHEET_CSV_URL;
  if (!sheet) return json({ ran: true, sent: 0, note: 'no reminder sheet configured' });

  let csv: string;
  try {
    const res = await fetch(sheet, { headers: { 'cache-control': 'no-cache' } });
    if (!res.ok) return json({ ran: true, sent: 0, error: `sheet returned ${res.status}` }, 200);
    csv = await res.text();
  } catch (err) {
    return json({ ran: true, sent: 0, error: `sheet unreachable: ${String(err)}` }, 200);
  }

  const roster = parseRoster(csv);
  const row = roster.find((r) => r.sunday === due.sunday);
  if (!row) return json({ ran: true, sent: 0, sunday: due.sunday, note: 'no roster row for that Sunday' });

  const { matched, unmatched, notes } = await matchNames(env, row.names);
  const db = getDb(env);

  // A Sunday whose roster says "Revival" is not a failure and not an oversight
  // — it is a week with no singers. Recorded so the dashboard shows the week
  // was handled deliberately, rather than leaving a silent gap that looks
  // identical to the job never running.
  if (matched.length === 0 && notes.length > 0 && unmatched.length === 0) {
    const key = `singing:${due.sunday}:note`;
    if (!(await alreadySent(env, key))) {
      await db.insert(schema.scheduledMessages).values({
        sourceKey: key, source: 'sheet', body: SINGING_REMINDER,
        sendAt: `${due.sunday}T00:00:00Z`, status: 'skipped',
        note: `No reminder — the roster says: ${notes.join(', ')}`,
        createdAt: nowIso(),
      }).onConflictDoNothing();
    }
    return json({ ran: true, sunday: due.sunday, sent: 0, notes,
                  note: 'no singers listed for that Sunday' });
  }
  const { segments } = countSegments(SINGING_REMINDER);

  // Anyone named but not reachable is RECORDED, so it shows in the dashboard.
  // A silent miss means someone turns up on Sunday not knowing they were on.
  for (const u of unmatched) {
    const key = `singing:${due.sunday}:unmatched:${u.name.toLowerCase()}`;
    if (await alreadySent(env, key)) continue;
    await db.insert(schema.scheduledMessages).values({
      sourceKey: key, source: 'sheet', body: SINGING_REMINDER,
      sendAt: `${due.sunday}T00:00:00Z`, status: 'skipped',
      note: `${u.name} — ${u.reason}`, createdAt: nowIso(),
    }).onConflictDoNothing();
  }

  if (dry) {
    return json({ ran: true, dryRun: true, sunday: due.sunday, late: due.late,
                  wouldSend: matched.map((m) => m.name), unmatched, notes });
  }
  if (!smsConfigured(env)) {
    return json({ ran: true, sent: 0, sunday: due.sunday,
                  error: 'Twilio not configured — nothing sent', unmatched });
  }

  let sent = 0;
  const failed: { name: string; reason: string }[] = [];

  for (const m of matched) {
    const key = reminderKey(due.sunday, m.personId);
    if (await alreadySent(env, key)) continue;

    // Claim the slot BEFORE sending. If the send succeeds but this Worker dies
    // before writing, a retry would text them twice; claiming first means the
    // worst case is a missed reminder that shows as pending, which is
    // recoverable. Texting someone twice is not.
    const claim = await db.insert(schema.scheduledMessages).values({
      sourceKey: key, source: 'sheet', body: SINGING_REMINDER,
      sendAt: `${due.sunday}T00:00:00Z`, status: 'pending', createdAt: nowIso(),
    }).onConflictDoNothing().returning({ id: schema.scheduledMessages.id });
    if (!claim[0]) continue;                       // another run already has it

    const result = await sendOne(env, m.phoneE164, SINGING_REMINDER);

    await db.insert(schema.messageLog).values({
      personId: m.personId, phoneE164: m.phoneE164, body: SINGING_REMINDER,
      direction: 'out', twilioSid: result.sid ?? null,
      status: result.ok ? (result.status ?? 'queued') : 'failed',
      errorCode: result.errorCode ?? null, segments,
      scheduledMessageId: claim[0].id, createdAt: nowIso(),
    });

    await db.update(schema.scheduledMessages)
      .set({ status: result.ok ? 'sent' : 'failed', sentAt: nowIso(),
             note: result.ok ? `${m.name}${due.late ? ' (sent late)' : ''}`
                             : `${m.name} — ${result.error ?? result.errorCode}` })
      .where(eq(schema.scheduledMessages.id, claim[0].id));

    if (result.ok) sent++; else failed.push({ name: m.name, reason: result.error ?? 'failed' });
  }

  return json({ ran: true, sunday: due.sunday, late: due.late, sent,
                failed, unmatched, notes });
};

import { eq } from 'drizzle-orm';
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
