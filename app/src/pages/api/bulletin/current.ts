import type { APIRoute } from 'astro';
import { and, desc, eq, lte, or } from 'drizzle-orm';
import { getDb, schema } from '../../../db';
import { parseAnnouncements, parsePrayerRequests, nextSunday } from '../../../lib/bulletin';
import { celebrationsFor } from '../../../lib/celebrations';
import { singingForBulletin } from '../../../lib/singing-sheet';

export const prerender = false;

/**
 * PUBLIC, read-only. The site's build machine has no session, so this cannot
 * be behind the login — and it does not need to be: a bulletin is handed out
 * on paper to anyone who walks in.
 *
 * Only PUBLISHED bulletins are ever returned. A draft stays invisible however
 * many times the site rebuilds, so a half-written order of service cannot
 * appear in a pew because someone happened to hit publish on the website.
 */
export const GET: APIRoute = async ({ locals }) => {
  const env = locals.runtime.env;
  const db = getDb(env);
  const sunday = nextSunday();

  // This Sunday's if it exists, otherwise the most recent published one — so
  // the page shows last week rather than going blank if nobody has written the
  // new one yet.
  const rows = await db.select().from(schema.bulletins)
    .where(and(eq(schema.bulletins.status, 'published'), lte(schema.bulletins.serviceDate, sunday)))
    .orderBy(desc(schema.bulletins.serviceDate)).limit(1);

  const b = rows[0];
  if (!b) return json({ bulletin: null });

  /*
   * The month's birthdays and anniversaries, taken from the bulletin's OWN
   * service date rather than from today — so an October bulletin still lists
   * October when the site rebuilds in November.
   *
   * The eligibility rule is deliberately the directory's, not "everyone with a
   * date on file". That means: children are excluded (they are never in the
   * directory), and anyone who asks to come off the directory comes off the
   * bulletin at the same moment, without anybody remembering to do it in two
   * places. One consent, one switch.
   */
  const people = await db.select({
    firstName: schema.people.firstName, lastName: schema.people.lastName,
    birthday: schema.people.birthday, anniversary: schema.people.anniversary,
    adultChild: schema.people.adultChild,
  }).from(schema.people)
    .where(and(
      eq(schema.people.archived, false),
      // Adults must be directory-listed; children are included regardless,
      // per the pastor. See isCelebrant in lib/celebrations for why this is not
      // simply the directory's rule.
      or(
        eq(schema.people.adultChild, 'child'),
        and(eq(schema.people.adultChild, 'adult'),
            eq(schema.people.includeInDirectory, true)),
      ),
    ));
  const celebrations = celebrationsFor(people, b.serviceDate);

  /*
   * Who is singing, from the same published sheet that drives the Monday
   * reminder — so the bulletin and the text can never disagree, and there is
   * one place to edit rather than two.
   *
   * Read live on every request, keyed off the bulletin's OWN service date. An
   * unreachable sheet yields null and the section is simply absent; it must
   * never be able to take the bulletin down.
   */
  const singing = await singingForBulletin(env, b.serviceDate);

  return json({
    bulletin: {
      serviceDate: b.serviceDate,
      title: b.title,
      preacher: b.preacher,
      announcements: parseAnnouncements(b.announcements),
      // Carried week to week, so this is usually non-empty even on a bulletin
      // nobody has edited. Only the text is published — `since` is staff-facing.
      prayerRequests: parsePrayerRequests(b.prayerRequests).map((x) => x.text),
      scripture: b.scripture,
      scriptureRef: b.scriptureRef,
      isCurrent: b.serviceDate === sunday,
      celebrations,
      singing,
    },
  });
};

const json = (o: unknown) =>
  new Response(JSON.stringify(o), {
    headers: {
      'content-type': 'application/json',
      // Read at build time; a short cache stops a rebuild loop hammering it.
      'cache-control': 'public, max-age=60',
      'access-control-allow-origin': '*',
    },
  });
