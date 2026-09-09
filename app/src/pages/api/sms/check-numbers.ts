import type { APIRoute } from 'astro';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { getDb, schema, nowIso } from '../../../db';
import { lookupNumber, smsConfigured } from '../../../lib/sms';

export const prerender = false;

/**
 * Asks Twilio what each number IS, without texting anybody.
 *
 * IN SLICES, for the same reason /api/sms/send is: a Workers request may make
 * 50 outbound fetches and the 51st fails. Looking up 77 handsets in one call
 * would check about fifty and silently lose the rest — the exact shape of the
 * bug that dropped 19, 21 and 24 texts on three broadcasts. The client walks
 * the offsets; this route does one window.
 *
 * Results are STORED, so the answer is bought once rather than every time
 * somebody wonders. Re-running costs money again, which is why the page says so.
 */
const PER_CALL = 40;

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Not signed in.' }, 401);

  const env = locals.runtime.env;
  if (!smsConfigured(env)) return json({ error: 'Twilio is not configured.' }, 400);

  const body = (await request.json().catch(() => null)) as { offset?: number } | null;
  const offset = Math.max(0, Number(body?.offset ?? 0));
  const db = getDb(env);

  // One row per DISTINCT number: Ed and Patti Hanson share a handset, and
  // paying twice to learn the same fact about the same phone is waste.
  const rows = await db
    .selectDistinct({ phoneE164: schema.people.phoneE164 })
    .from(schema.people)
    .where(and(eq(schema.people.archived, false),
               isNotNull(schema.people.phoneE164),
               ne(schema.people.phoneE164, '')))
    .orderBy(schema.people.phoneE164);

  const slice = rows.slice(offset, offset + PER_CALL);
  const remaining = Math.max(0, rows.length - (offset + slice.length));
  const results: { phone: string; lineType: string | null; valid: boolean; error?: string }[] = [];

  for (const r of slice) {
    const phone = r.phoneE164!;
    const res = await lookupNumber(env, phone);
    if (!res.ok) { results.push({ phone, lineType: null, valid: false, error: res.error }); continue; }

    // Written to EVERY person on that handset, so a shared line shows the same
    // answer on both records rather than only on whoever was checked.
    await db.update(schema.people)
      .set({ phoneLineType: res.valid ? (res.lineType ?? 'unknown') : 'invalid',
             phoneCarrier: res.carrier ?? null,
             phoneCheckedAt: nowIso() })
      .where(eq(schema.people.phoneE164, phone));

    results.push({ phone, lineType: res.valid ? (res.lineType ?? 'unknown') : 'invalid',
                   valid: res.valid !== false });
  }

  return json({
    ok: true, checked: slice.length, remaining,
    nextOffset: remaining > 0 ? offset + slice.length : null,
    total: rows.length, results,
  });
};

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
