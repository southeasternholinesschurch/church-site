import { and, desc, eq, lte, or } from 'drizzle-orm';
import { getDb, schema } from '../db';
import { parseAnnouncements, parsePrayerRequests, nextSunday, type PublicBulletin } from './bulletin';
import { celebrationsFor } from './celebrations';
import { singingForBulletin } from './singing-sheet';
import { openSignupsForBulletin } from './signups-db';

/**
 * The public bulletin, as the website's build and the lobby screen both see
 * it. Lifted out of /api/bulletin/current so there is ONE query and ONE
 * consent rule with two consumers — a second copy for the TV would be a second
 * place to forget that drafts are private, or that an adult who leaves the
 * directory leaves the birthdays too.
 *
 * Only PUBLISHED bulletins are ever returned. A draft stays invisible however
 * many times the site rebuilds, so a half-written bulletin cannot appear in a
 * pew — or on the foyer wall — because someone happened to hit publish.
 *
 * `origin` is the app's own, where the /signup/ links live.
 */
export async function currentBulletin(env: Env, origin: string): Promise<PublicBulletin | null> {
  const db = getDb(env);
  const sunday = nextSunday();

  // This Sunday's if it exists, otherwise the most recent published one — so
  // the page shows last week rather than going blank if nobody has written the
  // new one yet.
  const rows = await db.select().from(schema.bulletins)
    .where(and(eq(schema.bulletins.status, 'published'), lte(schema.bulletins.serviceDate, sunday)))
    .orderBy(desc(schema.bulletins.serviceDate)).limit(1);

  const b = rows[0];
  if (!b) return null;

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

  /*
   * Every sign-up sheet that is open RIGHT NOW, whatever week the bulletin is
   * for (the pastor, 2026-10-10). Opening a sheet is the whole step: nobody has to
   * remember to add it as an announcement.
   */
  const signups = await openSignupsForBulletin(db, origin);

  return {
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
    signups,
  };
}
