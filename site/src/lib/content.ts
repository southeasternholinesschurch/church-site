/**
 * Drafts are hidden from the production build but visible in `astro dev`, so
 * layouts can be checked locally without sample content ever going live.
 */
export function isPublished(data: { draft: boolean }): boolean {
  return import.meta.env.PROD ? !data.draft : true;
}

/**
 * How much of the sermon archive the SITE carries.
 *
 * Deliberately not "everything". The church has four years of services on
 * YouTube and that is where people go to find an old one anyway, so the site
 * keeps a rolling recent window and links out for the rest. That keeps the
 * build small, the archive scannable, and means nobody is maintaining 600
 * pages nobody visits.
 */
export const SERMON_WINDOW_MONTHS = 6;

/**
 * Is this service still inside the rolling window?
 *
 * Evaluated at BUILD time, so the window slides on its own: the nightly
 * rebuild drops whatever has aged out, with nothing to remember or run. The
 * markdown files are left alone — ageing out hides a service, it never
 * deletes it, so widening the window later brings entries straight back.
 *
 * (Month arithmetic can drift a day or two when the current date has no
 * counterpart in the target month — 31 August minus 6 months. Irrelevant at
 * this scale, and the alternative is fixed day counts, which drift more.)
 */
export function withinSermonWindow(date: Date, now: Date = new Date()): boolean {
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - SERMON_WINDOW_MONTHS, now.getUTCDate())
  );
  return date.getTime() >= cutoff.getTime();
}

/** The filter every sermon route shares, so no route can disagree. */
export function isVisibleSermon(data: { draft: boolean; date: Date }): boolean {
  return isPublished(data) && withinSermonWindow(data.date);
}
