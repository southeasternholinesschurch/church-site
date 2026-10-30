/**
 * The lobby screen's settings, changed on the Lobby tab (/lobby/manage):
 *
 *   pace     how long every scene stays up, as a multiplier on its own timing
 *   hidden   scene types switched off ("no birthdays this week")
 *   notice   one line put on the screen now, until a time or until removed
 *
 * Pure, like lib/lobby.ts: shared by the screen, the editor and the tests.
 * Stored as one row in app_settings ('lobby_settings').
 */

export interface LobbyNotice {
  title: string;
  detail: string;
  /** When to take it down: an instant (ISO), or null for "until removed". */
  until: string | null;
}

export interface LobbySettings {
  pace: number;
  hidden: string[];
  notice: LobbyNotice | null;
  /** Built-in photographs switched off (their file names). Uploaded ones are
   *  switched on and off on their own rows. */
  hiddenPhotos: string[];
}

export const DEFAULT_SETTINGS: LobbySettings = { pace: 1, hidden: [], notice: null, hiddenPhotos: [] };

/** A built-in photograph's name, as stored in hiddenPhotos. Checked by shape
 *  here (an unknown name is simply ignored by the screen). */
const PHOTO_NAME = /^[a-z0-9-]{1,60}$/;
const photoNames = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map(String).filter((k) => PHOTO_NAME.test(k)))].slice(0, 200) : [];

/**
 * Pace, as the editor offers it. A multiplier rather than a number of seconds,
 * so the screen's own judgement survives: a long list still stays up longer
 * than a short announcement, and a hero frame still holds longest.
 */
export const PACES: { value: number; label: string }[] = [
  { value: 0.75, label: 'Quicker' },
  { value: 1, label: 'Standard' },
  { value: 1.25, label: 'Relaxed' },
  { value: 1.5, label: 'Slow' },
  { value: 2, label: 'Slowest' },
];

/**
 * The scene types that may be switched off. The welcome, the five-minute
 * hold, the quiet scene and the night clock are not on the list: they are
 * what makes the screen tell the time, and switching one off would leave the
 * room without its "am I late?" answer.
 */
export const HIDEABLE: { kind: string; label: string }[] = [
  { kind: 'hero', label: 'Hero frames' },
  { kind: 'guest', label: 'New here? (guest card)' },
  { kind: 'give', label: 'Give' },
  { kind: 'sermon', label: 'Missed last Sunday? (sermon)' },
  { kind: 'text', label: 'Today’s text' },
  { kind: 'singing', label: 'Singing' },
  { kind: 'announcement', label: 'Announcements' },
  { kind: 'prayer', label: 'Prayer requests' },
  { kind: 'celebrations', label: 'Birthdays and anniversaries' },
  { kind: 'signup', label: 'Sign-up sheets' },
  { kind: 'events', label: 'Events' },
  { kind: 'next-sunday', label: 'Next Sunday' },
  { kind: 'services', label: 'Service times' },
  { kind: 'thanks', label: 'Thank you (after a service)' },
];

export const NOTICE_LIMITS = { title: 60, detail: 140 } as const;

/** Read defensively: a damaged row is the defaults, never an error. */
export function parseSettings(raw: string | null | undefined): LobbySettings {
  try {
    const v = JSON.parse(raw ?? '{}') as Partial<LobbySettings>;
    const pace = PACES.some((p) => p.value === v.pace) ? v.pace! : 1;
    const hidden = Array.isArray(v.hidden)
      ? v.hidden.filter((k): k is string => HIDEABLE.some((h) => h.kind === k)) : [];
    const n = v.notice;
    const notice = n && typeof n.title === 'string' && n.title.trim()
      ? { title: n.title.trim(), detail: typeof n.detail === 'string' ? n.detail.trim() : '',
          until: typeof n.until === 'string' && !Number.isNaN(Date.parse(n.until)) ? n.until : null }
      : null;
    return { pace, hidden, notice, hiddenPhotos: photoNames(v.hiddenPhotos) };
  } catch { return { ...DEFAULT_SETTINGS }; }
}

/** What the editor sent, checked. Everything here ends up on a wall. */
export function cleanSettings(input: { pace?: unknown; hidden?: unknown; notice?: Partial<Record<keyof LobbyNotice, unknown>> | null; hiddenPhotos?: unknown }):
  { ok: true; value: LobbySettings } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const pace = Number(input.pace ?? 1);
  if (!PACES.some((p) => p.value === pace)) errors.push('Choose one of the pace settings.');
  const hidden = (Array.isArray(input.hidden) ? input.hidden : [])
    .map(String).filter((k) => HIDEABLE.some((h) => h.kind === k));
  const tidy = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  let notice: LobbyNotice | null = null;
  if (input.notice) {
    const title = tidy(input.notice.title), detail = tidy(input.notice.detail);
    const untilRaw = tidy(input.notice.until);
    if (title) {
      if (title.length > NOTICE_LIMITS.title) errors.push(`The notice is ${title.length} characters; ${NOTICE_LIMITS.title} fit.`);
      if (detail.length > NOTICE_LIMITS.detail) errors.push(`The notice's second line is ${detail.length} characters; ${NOTICE_LIMITS.detail} fit.`);
      const until = untilRaw && !Number.isNaN(Date.parse(untilRaw)) ? new Date(untilRaw).toISOString() : null;
      if (untilRaw && !until) errors.push('“Take it down at” is not a time.');
      notice = { title, detail, until };
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: { pace, hidden, notice, hiddenPhotos: photoNames(input.hiddenPhotos) } };
}

/** Whether the notice is still up at `now`. */
export const noticeLive = (n: LobbyNotice | null, now: Date): n is LobbyNotice =>
  !!n && (!n.until || Date.parse(n.until) > now.getTime());
