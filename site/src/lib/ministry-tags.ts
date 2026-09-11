/**
 * Linking a calendar event to a ministry with a hashtag in its Notes.
 *
 * Put `#kids` anywhere in an event's Notes in Apple Calendar and the event
 * links to Fairhaven Kids on the Events page AND appears under Fairhaven Kids on the Ministries
 * page. Nothing else to configure, and it's typed on a phone while creating the
 * event — the same place the schedule detail already goes.
 *
 * The tag vocabulary is the ministries' own `accent` values, so it cannot drift
 * out of step with the content collection: #men, #kids, #youth,
 * #women, #seniors.
 *
 * Watch for a tag that is also an ordinary English word — writing it in an
 * event's Notes for its everyday meaning would file that event under the
 * ministry of the same name.
 *
 * Two behaviours worth stating, because both are deliberate:
 *
 *   - Recognised tags are STRIPPED from the text before it is shown. A visitor
 *     should never read "#kids" in the middle of a sentence about a party.
 *   - Unrecognised hashtags are LEFT ALONE. "#potluck" is someone writing
 *     prose, not a failed instruction, and silently deleting it would be worse
 *     than showing it.
 */

export const MINISTRY_TAGS = ['men', 'kids', 'youth', 'women', 'seniors'] as const;
export type MinistryTag = (typeof MINISTRY_TAGS)[number];

const TAG_RE = new RegExp(`#(${MINISTRY_TAGS.join('|')})\\b`, 'gi');

export interface TaggedNotes {
  /** Ministries this event belongs to, in the order the tags were written. */
  tags: MinistryTag[];
  /** The Notes with recognised tags removed, ready to display. */
  text?: string;
}

/**
 * Pull ministry tags out of an event's Notes.
 *
 * Case-insensitive, because these are typed on a phone where autocapitalise
 * will happily produce "#Fairhaven Kids".
 */
export function extractMinistryTags(notes?: string): TaggedNotes {
  if (!notes) return { tags: [] };

  const tags: MinistryTag[] = [];
  for (const m of notes.matchAll(TAG_RE)) {
    const tag = m[1].toLowerCase() as MinistryTag;
    if (!tags.includes(tag)) tags.push(tag);
  }

  const text = notes
    .replace(TAG_RE, '')
    // tidy what removal leaves behind: doubled spaces, a space before
    // punctuation, and stray blank lines
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();

  return { tags, text: text || undefined };
}

/** Display name for a tag. Kept here so it matches the tag vocabulary. */
export const MINISTRY_TAG_LABELS: Record<MinistryTag, string> = {
  men: 'Fairhaven Men',
  kids: 'Fairhaven Kids',
  youth: 'Fairhaven Youth',
  women: 'Fairhaven Ladies',
  seniors: 'Fairhaven Seniors',
};

/** Where a tagged event links to — each ministry has its own page. */
export function ministryHref(tag: MinistryTag): string {
  return `/ministries/${tag}`;
}
