/**
 * The church's own facts — name, address, service times, links — as edited from
 * the dashboard and stored in the site's git repository.
 *
 * Edits go through a YAML *Document*, not parse-then-re-serialise. That
 * distinction is the whole reason this file exists: site.yaml carries nineteen
 * comments, several of which are the only place a rule is written down ("Leave
 * EMPTY until Twilio is set up: blank hides the opt-in section, which is
 * deliberate"). Round-tripping through a plain object would silently delete
 * every one of them the first time somebody changed a phone number.
 */
import { parseDocument } from 'yaml';
import { readFile, writeFile, commitMessage, YAML_OUT, type GitEnv } from './site-content';

export const SETTINGS_PATH = 'site/src/content/settings/site.yaml';

export interface ServiceTime { label: string; day: string; time: string }

export interface SiteSettings {
  churchName: string;
  address: string;
  mapsUrl: string;
  email: string;
  phone: string;
  smsNumber: string;
  serviceTimes: ServiceTime[];
  socials: { facebook: string; instagram: string; youtubeUrl: string; youtubeChannelId: string };
  zeffyUrl: string;
  givingLinksUrl: string;
  calendarFeedUrl: string;
  webAnalyticsToken: string;
}

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export async function readSettings(env: GitEnv): Promise<{ settings: SiteSettings; sha: string } | null> {
  const file = await readFile(env, SETTINGS_PATH);
  if (!file) return null;
  const raw = parseDocument(file.text).toJS() ?? {};
  return {
    sha: file.sha,
    settings: {
      churchName: str(raw.churchName),
      address: str(raw.address),
      mapsUrl: str(raw.mapsUrl),
      email: str(raw.email),
      phone: str(raw.phone),
      smsNumber: str(raw.smsNumber),
      serviceTimes: Array.isArray(raw.serviceTimes)
        ? raw.serviceTimes.map((s: any) => ({ label: str(s?.label), day: str(s?.day), time: str(s?.time) }))
        : [],
      socials: {
        facebook: str(raw.socials?.facebook),
        instagram: str(raw.socials?.instagram),
        youtubeUrl: str(raw.socials?.youtubeUrl),
        youtubeChannelId: str(raw.socials?.youtubeChannelId),
      },
      zeffyUrl: str(raw.zeffyUrl),
      givingLinksUrl: str(raw.givingLinksUrl),
      calendarFeedUrl: str(raw.calendarFeedUrl),
      webAnalyticsToken: str(raw.webAnalyticsToken),
    },
  };
}

/**
 * What the site's own schema will reject at build time, checked here instead —
 * so a bad value is a message on the form rather than a failed build twenty
 * minutes later that nobody is watching.
 */
export function validate(s: SiteSettings): string[] {
  const problems: string[] = [];
  if (!s.churchName.trim()) problems.push('The church needs a name.');
  if (!s.address.trim()) problems.push('The address is shown on the contact page and in search results.');
  if (s.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.email)) problems.push(`"${s.email}" is not an email address.`);
  for (const [label, url] of [
    ['Map link', s.mapsUrl], ['Giving link', s.zeffyUrl], ['Giving links page', s.givingLinksUrl],
    ['Facebook', s.socials.facebook], ['Instagram', s.socials.instagram],
    ['YouTube', s.socials.youtubeUrl], ['Calendar feed', s.calendarFeedUrl],
  ] as const) {
    if (url && !/^https?:\/\//.test(url)) problems.push(`${label} must start with http:// or https://`);
  }
  s.serviceTimes.forEach((t, i) => {
    if (!t.label.trim()) return;
    if (!/^\d{2}:\d{2}$/.test(t.time)) problems.push(`Service ${i + 1} ("${t.label}") needs a time like 10:00 or 17:30.`);
    if (!DAYS.includes(t.day as any)) problems.push(`Service ${i + 1} ("${t.label}") needs a day of the week.`);
  });
  if (!s.serviceTimes.some((t) => t.label.trim())) problems.push('Keep at least one service time — the whole site reads these.');
  return problems;
}

export async function saveSettings(
  env: GitEnv, next: SiteSettings, sha: string | undefined, who: { email: string },
): Promise<void> {
  const file = await readFile(env, SETTINGS_PATH);
  const doc = parseDocument(file?.text ?? '{}');

  const set = (path: (string | number)[], value: string) => {
    // An empty optional stays empty rather than becoming the string "undefined".
    doc.setIn(path, value);
  };

  set(['churchName'], next.churchName.trim());
  set(['address'], next.address.trim());
  set(['mapsUrl'], next.mapsUrl.trim());
  set(['email'], next.email.trim());
  set(['phone'], next.phone.trim());
  set(['smsNumber'], next.smsNumber.trim());
  set(['socials', 'facebook'], next.socials.facebook.trim());
  set(['socials', 'instagram'], next.socials.instagram.trim());
  set(['socials', 'youtubeUrl'], next.socials.youtubeUrl.trim());
  set(['socials', 'youtubeChannelId'], next.socials.youtubeChannelId.trim());
  set(['zeffyUrl'], next.zeffyUrl.trim());
  set(['givingLinksUrl'], next.givingLinksUrl.trim());
  set(['calendarFeedUrl'], next.calendarFeedUrl.trim());
  if (next.webAnalyticsToken.trim() || doc.has('webAnalyticsToken')) {
    set(['webAnalyticsToken'], next.webAnalyticsToken.trim());
  }

  /*
   * Rows whose label was cleared are deletions — that is how you remove one
   * without a delete button that could be pressed by accident.
   *
   * Updated FIELD BY FIELD rather than by replacing the array, which is not
   * fussiness: setIn on the whole list swaps the node and takes every comment
   * inside it with it. That really happened — changing a phone number silently
   * deleted the two lines explaining that Sunday School is when Fairhaven Kids and
   * Fairhaven Youth meet, which is exactly the kind of note nobody writes twice.
   *
   * The residual quirk, stated rather than hidden: a comment belongs to a
   * POSITION, so deleting a service from the middle of the list leaves any
   * comment below it attached to whatever moves up. Cosmetic, visible, and far
   * better than losing the text.
   */
  const times = next.serviceTimes.filter((t) => t.label.trim());
  const existing = Array.isArray((doc.toJS() ?? {}).serviceTimes)
    ? (doc.toJS() as any).serviceTimes.length : 0;

  times.forEach((t, i) => {
    if (i < existing) {
      doc.setIn(['serviceTimes', i, 'label'], t.label.trim());
      doc.setIn(['serviceTimes', i, 'day'], t.day);
      doc.setIn(['serviceTimes', i, 'time'], t.time);
    } else {
      doc.addIn(['serviceTimes'], { label: t.label.trim(), day: t.day, time: t.time });
    }
  });
  // Trim from the end, backwards, so each removal cannot shift the next index.
  for (let i = existing - 1; i >= times.length; i--) doc.deleteIn(['serviceTimes', i]);

  await writeFile(env, {
    path: SETTINGS_PATH,
    content: YAML_OUT(doc),
    sha: sha ?? file?.sha,
    message: commitMessage('Site settings updated', who),
  });
}
