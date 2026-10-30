/**
 * "Send it now", made so a broadcast cannot stop halfway.
 *
 * It used to be the BROWSER that sent a broadcast: it asked the server for 40
 * texts at a time and kept asking until nobody was left. A Worker request may
 * make only 50 outbound calls, so the slicing itself was necessary. But it
 * meant that if the phone locked, the person switched apps or the signal
 * dropped between slices, everybody after that point was simply never sent
 * to, and nothing anywhere recorded that they had been missed (the pastor,
 * 2026-10-21: "I want to ensure this never happens and all texts are sent out").
 *
 * Now the first request puts EVERY recipient in the queue (scheduled_messages)
 * before sending anything. Then it, and the page while it stays open, drain
 * that broadcast 40 at a time. If the page goes away, the five-minute cron
 * drains whatever is left, and the troubleshooting page shows anything still
 * waiting. Nothing is ever held only in a browser.
 *
 * One queue row per HANDSET, keyed `{prefix}:{broadcastId}:{phone}`. The unique
 * index on source_key means a retried first request queues nobody twice.
 */
import { and, eq, like, sql } from 'drizzle-orm';
import { schema, nowIso, type Db } from '../db';

/** The id the page makes for one press of Send. */
export const isBroadcastId = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(v);

export const broadcastPrefix = (prefix: string, broadcastId: string) => `${prefix}:${broadcastId}:`;

export async function enqueueBroadcast(
  db: Db,
  o: {
    prefix: string; broadcastId: string; body: string; groupId: number | null;
    handsets: { phoneE164: string; personId: number | null }[];
  },
): Promise<number> {
  const at = nowIso();
  const stmts = o.handsets.map((h) => db.insert(schema.scheduledMessages).values({
    sourceKey: `${broadcastPrefix(o.prefix, o.broadcastId)}${h.phoneE164}`,
    source: 'schedule',
    personId: h.personId,
    phoneE164: h.phoneE164,
    body: o.body,
    groupId: o.groupId,
    sendAt: at,
    status: 'pending',
    createdAt: at,
  }).onConflictDoNothing());
  if (!stmts.length) return 0;
  // One round trip for the whole audience: a broadcast is queued in full or
  // the request fails before anything is sent.
  const [first, ...rest] = stmts;
  await db.batch([first!, ...rest]);
  return stmts.length;
}

export interface Progress { total: number; sent: number; failed: number; pending: number }

/** Where one broadcast has got to, read from the queue. */
export async function broadcastProgress(db: Db, prefix: string, broadcastId: string): Promise<Progress> {
  const rows = await db.select({ status: schema.scheduledMessages.status, n: sql<number>`count(*)` })
    .from(schema.scheduledMessages)
    .where(and(
      eq(schema.scheduledMessages.source, 'schedule'),
      like(schema.scheduledMessages.sourceKey, `${broadcastPrefix(prefix, broadcastId)}%`),
    ))
    .groupBy(schema.scheduledMessages.status);
  const n = (s: string) => Number(rows.find((r) => r.status === s)?.n ?? 0);
  return {
    total: rows.reduce((t, r) => t + Number(r.n), 0),
    sent: n('sent'),
    failed: n('failed') + n('skipped'),
    pending: n('pending'),
  };
}
