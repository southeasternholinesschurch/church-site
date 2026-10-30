/**
 * The lobby screen's own words — every fixed phrase on every scene — and the
 * rules for changing them from the Lobby tab (/lobby/manage).
 *
 * What is NOT here, because it already has a home: the bulletin's content
 * (announcements, prayer requests, scripture, who is singing) is edited in the
 * bulletin; events come from the calendar; hero frames have their own editor.
 * This is the frame those things sit in: "Please pray for", "Scan to give".
 *
 * Saved as ONE row in app_settings ('lobby_copy'), holding only the phrases
 * somebody changed. Anything not there falls back to the default below, so
 * clearing a field restores the original, and a phrase added to this list in
 * a later version simply appears with its default.
 *
 * Pure: shared by the screen (in the browser), the editor, and the tests.
 */

export interface CopyField {
  key: string;
  label: string;
  default: string;
  max: number;
  /** Placeholders the phrase may use, filled in on the screen. */
  tokens?: string[];
  hint?: string;
  long?: boolean;
}

export interface CopySection {
  /** The scene this section belongs to, for the preview. */
  scene: string;
  title: string;
  /** Where the preview should be set, relative to the coming Sunday. */
  preview: 'sunday-before' | 'sunday-during' | 'sunday-after' | 'weekday';
  fields: CopyField[];
}

export const COPY_SECTIONS: CopySection[] = [
  {
    scene: 'notice', title: 'Notice', preview: 'sunday-before', fields: [
      { key: 'notice.label', label: 'Small capitals above a notice', default: 'Please note', max: 24 },
    ],
  },
  {
    scene: 'welcome', title: 'Welcome (the hour before a service)', preview: 'sunday-before', fields: [
      { key: 'welcome.label', label: 'Small capitals', default: 'Welcome', max: 30, hint: 'The date follows it.' },
      { key: 'welcome.until', label: 'Beside the countdown', default: 'until we begin', max: 40, hint: '“minutes” is added before it.' },
      { key: 'welcome.where', label: 'Under the countdown', default: 'in the sanctuary', max: 40, hint: 'Follows the start time.' },
    ],
  },
  {
    scene: 'guest', title: 'New here? (guest card)', preview: 'sunday-before', fields: [
      { key: 'guest.label', label: 'Small capitals', default: 'Welcome', max: 30 },
      { key: 'guest.head', label: 'Headline', default: 'New here?', max: 30 },
      { key: 'guest.em', label: 'Headline, second line (italic)', default: 'Fill out a guest card', max: 34 },
      { key: 'guest.body', label: 'Sentence', default: 'Only your first name is needed. If you’d like a visit or a call, that’s the place to ask.', max: 120, long: true },
      { key: 'guest.scan', label: 'Under the code', default: 'Scan for a guest card', max: 30 },
      { key: 'guest.note', label: 'Under that', default: 'or tap the card in your pew', max: 40 },
      { key: 'guest.addr', label: 'The address in words', default: 'yourchurch.org/welcome', max: 40, hint: 'Only the words: the code always opens the guest card.' },
    ],
  },
  {
    scene: 'give', title: 'Give', preview: 'sunday-before', fields: [
      { key: 'give.label', label: 'Small capitals', default: 'Give', max: 30 },
      { key: 'give.head', label: 'Headline', default: 'Every gift stays', max: 30 },
      { key: 'give.em', label: 'Headline, second line (italic)', default: 'close to home', max: 34 },
      { key: 'give.body', label: 'Sentence', default: 'Giving keeps the lights on, the doors open, and this church serving the neighborhood it sits in.', max: 120, long: true },
      { key: 'give.scan', label: 'Under the code', default: 'Scan to give', max: 30 },
      { key: 'give.note', label: 'Under that', default: 'Zeffy passes on 100% of your gift', max: 40 },
      { key: 'give.addr', label: 'The address in words', default: 'yourchurch.org/give', max: 40, hint: 'Only the words: the code follows the giving link in Website → Settings.' },
    ],
  },
  {
    scene: 'sermon', title: 'Missed last Sunday?', preview: 'weekday', fields: [
      { key: 'sermon.label', label: 'Small capitals', default: 'Missed last Sunday?', max: 30 },
      { key: 'sermon.labelToday', label: 'Small capitals, on the Sunday itself', default: 'Missed this morning?', max: 30 },
      { key: 'sermon.head', label: 'Headline', default: 'Catch up', max: 30 },
      { key: 'sermon.em', label: 'Headline, second line (italic)', default: 'on our website', max: 34 },
      { key: 'sermon.speaker', label: 'Above who preached', default: 'Preached by', max: 24 },
      { key: 'sermon.scripture', label: 'Above the passage', default: 'Scripture', max: 24 },
      { key: 'sermon.scan', label: 'Under the code', default: 'Scan to watch', max: 30 },
      { key: 'sermon.note', label: 'Under that', default: 'or read the transcript', max: 40, hint: 'Shown when the sermon has a transcript.' },
      { key: 'sermon.noteVideo', label: 'Under that, with no transcript', default: 'the whole service, on video', max: 40 },
      { key: 'sermon.addr', label: 'The address in words', default: 'yourchurch.org/sermons', max: 40, hint: 'Only the words: the code always opens that sermon’s page.' },
    ],
  },
  {
    scene: 'text', title: 'Today’s text', preview: 'sunday-before', fields: [
      { key: 'text.today', label: 'On the Sunday', default: 'Today’s text', max: 30 },
      { key: 'text.recent', label: 'During the week after', default: 'Sunday’s text', max: 30 },
      { key: 'text.next', label: 'Before the Sunday', default: 'Next Sunday’s text', max: 30 },
      { key: 'text.preaching', label: 'Before the preacher’s name', default: 'Preaching', max: 20 },
    ],
  },
  {
    scene: 'singing', title: 'Singing', preview: 'sunday-before', fields: [
      { key: 'singing.label', label: 'Small capitals', default: 'Singing today', max: 30 },
    ],
  },
  {
    scene: 'announcement', title: 'Announcements', preview: 'sunday-before', fields: [
      { key: 'announcement.label', label: 'Small capitals, when an announcement has no “when”', default: 'Announcement', max: 30 },
    ],
  },
  {
    scene: 'prayer', title: 'Prayer requests', preview: 'sunday-before', fields: [
      { key: 'prayer.label', label: 'Small capitals', default: 'Please pray for', max: 30 },
    ],
  },
  {
    scene: 'celebrations', title: 'Birthdays and anniversaries', preview: 'sunday-before', fields: [
      { key: 'celebrations.birthdays', label: 'Birthdays heading', default: '{month} birthdays', max: 34, tokens: ['month'] },
      { key: 'celebrations.anniversaries', label: 'Anniversaries heading', default: '{month} anniversaries', max: 34, tokens: ['month'] },
    ],
  },
  {
    scene: 'signup', title: 'Sign-up sheets', preview: 'sunday-before', fields: [
      { key: 'signup.label', label: 'Small capitals', default: 'Sign-up · open now', max: 30 },
      { key: 'signup.scan', label: 'Beside the code', default: 'Scan with your phone', max: 30 },
      { key: 'signup.note', label: 'Under that', default: 'or ask at the welcome desk', max: 40 },
    ],
  },
  {
    scene: 'starting', title: 'The last five minutes', preview: 'sunday-before', fields: [
      { key: 'starting.beginsIn', label: 'Above the number', default: 'begins in', max: 24 },
      { key: 'starting.ask', label: 'Under the number', default: 'Please make your way into the sanctuary.', max: 60 },
    ],
  },
  {
    scene: 'quiet', title: 'During a service', preview: 'sunday-during', fields: [
      { key: 'quiet.label', label: 'Small capitals', default: 'Now', max: 24 },
      { key: 'quiet.headline', label: 'Headline', default: '{service} is under way', max: 40, tokens: ['service'] },
      { key: 'quiet.body', label: 'Sentence', default: 'Come on in. You’re very welcome.', max: 60 },
    ],
  },
  {
    scene: 'thanks', title: 'After a service', preview: 'sunday-after', fields: [
      { key: 'thanks.label', label: 'Small capitals', default: 'Thank you for worshipping with us', max: 44 },
      { key: 'thanks.fallback', label: 'When no service is coming up', default: 'See you soon', max: 30 },
    ],
  },
  {
    scene: 'events', title: 'Events', preview: 'weekday', fields: [
      { key: 'events.week', label: 'The next seven days', default: 'This week', max: 24 },
      { key: 'events.coming', label: 'Further ahead', default: 'Coming up', max: 24 },
    ],
  },
  {
    scene: 'services', title: 'Service times', preview: 'weekday', fields: [
      { key: 'services.label', label: 'Small capitals', default: 'Join us', max: 24 },
    ],
  },
  {
    scene: 'next-sunday', title: 'Next Sunday', preview: 'weekday', fields: [
      { key: 'nextSunday.label', label: 'Small capitals', default: 'Next Sunday', max: 24, hint: 'The date follows it.' },
    ],
  },
];

const FIELDS = new Map(COPY_SECTIONS.flatMap((s) => s.fields).map((f) => [f.key, f]));

/**
 * A phrase for the screen: the saved one if there is one, else the default,
 * with its placeholders filled. An unknown key returns itself, loudly, so a
 * typo shows up on the screen in testing rather than as a blank.
 */
export function copyText(saved: Record<string, string> | undefined, key: string, vars: Record<string, string> = {}): string {
  const f = FIELDS.get(key);
  const raw = saved?.[key]?.trim() || f?.default || key;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? vars[name]! : m));
}

/**
 * What the editor sent, made safe to keep: known keys only, whitespace tidied,
 * no control characters, within each field's length, and only phrases that
 * DIFFER from the default — so a later change to a default reaches every
 * phrase nobody actually customised.
 */
export function cleanCopy(input: Record<string, unknown>):
  { ok: true; value: Record<string, string> } | { ok: false; errors: string[] } {
  const value: Record<string, string> = {};
  const errors: string[] = [];
  for (const [key, raw] of Object.entries(input)) {
    const f = FIELDS.get(key);
    if (!f || typeof raw !== 'string') continue;
    // eslint-disable-next-line no-control-regex
    const v = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!v || v === f.default) continue;
    if (v.length > f.max) { errors.push(`“${f.label}” (${sectionOf(key)}) is ${v.length} characters; ${f.max} fit`); continue; }
    const unknown = [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).filter((t) => !(f.tokens ?? []).includes(t));
    if (unknown.length) { errors.push(`“${f.label}” (${sectionOf(key)}) can't use {${unknown[0]}}`); continue; }
    value[key] = v;
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** Saved words, read defensively: a damaged row is no words, never an error. */
export function parseCopy(raw: string | null | undefined): Record<string, string> {
  try {
    const v = JSON.parse(raw ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, string> = {};
    for (const [k, s] of Object.entries(v)) if (FIELDS.has(k) && typeof s === 'string') out[k] = s;
    return out;
  } catch { return {}; }
}

const sectionOf = (key: string) => COPY_SECTIONS.find((s) => s.fields.some((f) => f.key === key))?.title ?? '';
