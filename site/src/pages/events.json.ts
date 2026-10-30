import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getUpcomingEvents } from '../lib/ical';
import { eventWhen, eventDateBlock } from '../lib/format';
import { isVisibleSermon } from '../lib/content';

/**
 * The events, as data, for the lobby screen in the staff app.
 *
 * Events live in the pastor's iCloud calendar and are parsed HERE, at build time,
 * with node-ical — which the app's Worker cannot run. So rather than parse the
 * feed twice in two runtimes (and fight recurring events and DST twice), the
 * site writes out what it already worked out, and the app fetches this file.
 *
 * Every event arrives ALREADY FORMATTED by the same eventWhen/eventDateBlock
 * the Events page uses, so the TV and the website can never disagree about
 * when something is — including the all-day and multi-day cases that put the
 * Revival on the wrong day once.
 *
 * Prerendered like everything else on this site: it is as fresh as the last
 * build, which is nightly and on every content commit. That is fresh enough
 * for a calendar.
 *
 * Three months, the same horizon as the bulletin's "Coming Up", so the screen
 * can show the dates the bulletin asks people to keep in mind.
 */
const DAYS = 92;

export const GET: APIRoute = async ({ site }) => {
  const [settingsEntry] = await getCollection('settings');
  const settings = settingsEntry.data;

  let events: Awaited<ReturnType<typeof getUpcomingEvents>> = [];
  if (settings.calendarFeedUrl) {
    // A dead feed must not fail the build. It yields an empty list, which the
    // lobby already treats as "no events", exactly as the Events page does.
    try { events = await getUpcomingEvents(settings.calendarFeedUrl, DAYS); } catch { /* none */ }
  }

  /*
   * The most recent Sunday-morning sermon, for the screen's "Missed last
   * Sunday?" scene. The screen decides whether it is recent enough to call it
   * that; the site only says which one it is. Posting a sermon commits to this
   * repository, which rebuilds this file, so the TV follows within minutes.
   */
  const [sermon] = (await getCollection('sermons', ({ data }) =>
    isVisibleSermon(data) && data.serviceType === 'sunday-morning'))
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());

  return new Response(JSON.stringify({
    generatedAt: new Date().toISOString(),
    churchName: settings.churchName,
    address: settings.address,
    serviceTimes: settings.serviceTimes,
    // The lobby's Give scene points its QR code here, so changing the giving
    // link in Settings changes the TV too.
    giveUrl: settings.zeffyUrl ?? null,
    sermon: sermon ? {
      title: sermon.data.title?.trim() || sermon.data.service,
      speaker: sermon.data.speaker ?? null,
      scripture: sermon.data.scripture ?? null,
      // Date-only frontmatter is UTC midnight (see SermonCard.astro).
      date: sermon.data.date.toISOString().slice(0, 10),
      url: new URL(`/sermons/${sermon.slug}`, site).href,
      hasTranscript: sermon.body.trim().length > 0,
    } : null,
    events: events.map((e) => ({
      title: e.title,
      start: e.start.toISOString(),
      lastDay: e.lastDay.toISOString(),
      allDay: e.allDay,
      multiDay: e.multiDay,
      when: eventWhen(e, { withDate: true }),
      dateBlock: eventDateBlock(e),
      location: e.location ?? null,
      description: e.description ?? null,
      url: e.url ?? null,
      ministries: e.ministries,
    })),
  }), { headers: { 'content-type': 'application/json' } });
};
