import type { APIRoute } from 'astro';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { getDb, schema } from '../../../db';

/**
 * CSV of people, for the brief's §10 requirement that phone numbers be
 * exportable. Behind the login like everything else — this is the single file
 * that carries the congregation's contact details, so it must never become a
 * public URL.
 *
 * `?texting=1` narrows it to people who can actually be texted, which is the
 * list worth handing to anything external.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) return new Response('not signed in', { status: 401 });

  const db = getDb(locals.runtime.env);
  const textingOnly = url.searchParams.get('texting') === '1';

  const where = [eq(schema.people.archived, false)];
  if (textingOnly) {
    where.push(isNotNull(schema.people.phoneE164));
    where.push(eq(schema.people.smsConsent, 'opted_in'));
  }

  const rows = await db.select({
    firstName: schema.people.firstName, lastName: schema.people.lastName,
    phone: schema.people.phone, phoneE164: schema.people.phoneE164,
    email: schema.people.email, adultChild: schema.people.adultChild,
    smsConsent: schema.people.smsConsent,
  }).from(schema.people).where(and(...where))
    .orderBy(asc(schema.people.lastName), asc(schema.people.firstName));

  // Quote everything and double any quote inside. A name like O'Brien is fine
  // unquoted; one containing a comma is not, and guessing which is which per
  // field is how a CSV silently shifts a column.
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['First name', 'Last name', 'Phone', 'Phone (E.164)', 'Email', 'Adult/child', 'Texting'];
  const body = rows.map((r) => [
    r.firstName, r.lastName, r.phone, r.phoneE164, r.email, r.adultChild, r.smsConsent,
  ].map(esc).join(','));

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response([header.map(esc).join(','), ...body].join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition':
        `attachment; filename="seh-${textingOnly ? 'texting-list' : 'people'}-${stamp}.csv"`,
      // Never cached anywhere: this is the congregation's contact details.
      'cache-control': 'no-store',
    },
  });
};
