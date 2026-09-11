/**
 * SMS: phone normalisation, segment counting, and sending through Twilio.
 *
 * No Twilio SDK. It is built on Node's HTTP stack and is unreliable on
 * Workers; sending is one authenticated POST and this file is smaller than the
 * shim would be. Credentials live in Worker secrets and never reach a browser.
 */

// Explicit .ts: Vite is happy either way, plain Node's ESM resolver is not,
// and sms.ts is imported directly by the tests.
import { DEMO_SEND_REFUSED } from './demo-instance.ts';

export interface SmsEnv {
  /** "1" on the public demo deployment. Blocks every send — see sendOne. */
  DEMO_INSTANCE?: string;
  /** Always required — it identifies the account in the request URL. */
  TWILIO_ACCOUNT_SID?: string;
  /** Preferred: a Standard API key (SK…) and its secret. */
  TWILIO_API_KEY_SID?: string;
  TWILIO_API_KEY_SECRET?: string;
  /** Fallback: the account's own Auth Token. Works, but it is the master
   *  credential — revoking it breaks everything else using the account, and
   *  it can do anything the account can. Prefer an API key. */
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
}

/**
 * Basic-auth pair for the REST API.
 *
 * An API key authenticates as SID:SECRET while the ACCOUNT sid stays in the
 * URL path — they are not interchangeable, and using the key sid in the path
 * is the usual way this fails with a confusing 404.
 */
function credentials(env: SmsEnv): { user: string; pass: string } | null {
  if (env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET)
    return { user: env.TWILIO_API_KEY_SID, pass: env.TWILIO_API_KEY_SECRET };
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)
    return { user: env.TWILIO_ACCOUNT_SID, pass: env.TWILIO_AUTH_TOKEN };
  return null;
}

export const smsConfigured = (env: SmsEnv) =>
  Boolean(env.TWILIO_ACCOUNT_SID && credentials(env)
    && (env.TWILIO_FROM_NUMBER || env.TWILIO_MESSAGING_SERVICE_SID));

/* ------------------------------------------------------------------ phone -- */

/**
 * To E.164, or null. Returns null rather than guessing: a number we cannot be
 * confident about must not be texted, because the cost of being wrong is a
 * message to a stranger.
 *
 * Deliberately US-only. Every number in this database is Fairhaven, and a
 * general-purpose parser would accept far more than it should.
 */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  // Already E.164 and not US — pass it through only if it is plausible.
  const trimmed = String(raw).trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;
  return null;
}

/* --------------------------------------------------------------- segments -- */

/** Characters GSM-7 can carry. Anything outside forces the whole message to
 *  UCS-2, which cuts the per-segment budget from 160 to 70. */
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** These cost TWO GSM-7 characters each — an escape plus the character. */
const GSM7_EXTENDED = '^{}\\[~]|€';

export interface SegmentInfo {
  encoding: 'GSM-7' | 'UCS-2';
  characters: number;
  /** Billable units, which is what the cost estimate multiplies. */
  segments: number;
  /** How many more characters fit before another segment is billed. */
  remainingInSegment: number;
}

export function countSegments(body: string): SegmentInfo {
  const chars = [...body];               // spread, so an emoji is one item
  let unicode = false;
  let units = 0;

  for (const ch of chars) {
    if (GSM7.includes(ch)) { units += 1; continue; }
    if (GSM7_EXTENDED.includes(ch)) { units += 2; continue; }
    unicode = true;
    break;
  }

  if (unicode) {
    // UCS-2 counts 16-bit code units, so an emoji outside the BMP costs two.
    units = [...body].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
    const single = 70, multi = 67;       // concatenated parts lose 3 to a header
    const segments = units <= single ? 1 : Math.ceil(units / multi);
    const cap = segments === 1 ? single : multi * segments;
    return { encoding: 'UCS-2', characters: chars.length, segments: Math.max(1, segments),
             remainingInSegment: cap - units };
  }

  const single = 160, multi = 153;
  const segments = units <= single ? 1 : Math.ceil(units / multi);
  const cap = segments === 1 ? single : multi * segments;
  return { encoding: 'GSM-7', characters: chars.length, segments: Math.max(1, segments),
           remainingInSegment: cap - units };
}

/* ------------------------------------------------------------------ send -- */

export interface SendResult {
  ok: boolean;
  sid?: string;
  status?: string;
  errorCode?: string;
  error?: string;
}

/**
 * Sends ONE message. Never throws — a batch must survive a bad number, and a
 * thrown error mid-loop would abandon everyone after it.
 */
export async function sendOne(env: SmsEnv, to: string, body: string): Promise<SendResult> {
  /*
   * THE demo guard. Deliberately the very first line of the ONLY function in
   * this app that talks to Twilio, so there is exactly one place to get it
   * right and no route around it — not the broadcast, not the scheduler, not
   * the birthday job, not a one-off from somebody's profile.
   *
   * Checked here rather than in the interface because a hidden button is not a
   * disabled one, and a public demo that could reach real handsets would be
   * worse than having no demo at all.
   */
  if (env.DEMO_INSTANCE === '1') {
    return { ok: false, error: DEMO_SEND_REFUSED, errorCode: 'demo' };
  }
  if (!smsConfigured(env)) return { ok: false, error: 'Twilio is not configured' };

  const url = `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
  const form = new URLSearchParams({ To: to, Body: body });
  if (env.TWILIO_MESSAGING_SERVICE_SID) form.set('MessagingServiceSid', env.TWILIO_MESSAGING_SERVICE_SID);
  else form.set('From', env.TWILIO_FROM_NUMBER!);

  const cred = credentials(env)!;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${cred.user}:${cred.pass}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, errorCode: String(data.code ?? res.status),
               error: String(data.message ?? `Twilio returned ${res.status}`) };
    }
    return { ok: true, sid: String(data.sid ?? ''), status: String(data.status ?? 'queued') };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/* ---------------------------------------------------------------- lookup -- */

export interface LookupResult {
  ok: boolean;
  /** Twilio's verdict on whether the number exists at all. */
  valid?: boolean;
  /** 'mobile' | 'landline' | 'voip' | 'nonFixedVoip' | … as Twilio reports it. */
  lineType?: string | null;
  carrier?: string | null;
  error?: string;
}

/**
 * Ask Twilio about a number WITHOUT texting it.
 *
 * The point is line type. A landline cannot receive SMS at all, and that is the
 * likeliest meaning of error 30005 ("unknown destination handset") — which is
 * what a number from a printed church directory tends to be, because household
 * lines are exactly what people write on a paper form.
 *
 * Costs about half a cent per number for line_type_intelligence; plain
 * validation is free but only tells you the number is well-formed, which is not
 * the question anybody is actually asking.
 *
 * NEVER THROWS, like sendOne, and for the same reason: this runs over a whole
 * congregation in a loop, and one bad number must not abandon everyone after it.
 */
export async function lookupNumber(env: SmsEnv, e164: string): Promise<LookupResult> {
  // Lookup reaches Twilio and costs money, so the demo answers from nowhere.
  // Reported as mobile because that is what the real answer almost always is,
  // and a demo full of "invalid" would misrepresent the feature.
  if (env.DEMO_INSTANCE === '1') {
    return { ok: true, valid: true, lineType: 'mobile', carrier: 'Demo Wireless' };
  }
  const cred = credentials(env);
  if (!cred) return { ok: false, error: 'Twilio is not configured' };

  const url = `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(e164)}`
            + '?Fields=line_type_intelligence';
  try {
    const res = await fetch(url, {
      headers: { authorization: `Basic ${btoa(`${cred.user}:${cred.pass}`)}` },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, any>;
    if (!res.ok) {
      // 404 is Twilio's answer for "that is not a real number", which is a
      // RESULT rather than a failure — reported as invalid, not as an error,
      // so it shows up in the table instead of looking like a broken check.
      if (res.status === 404) return { ok: true, valid: false, lineType: null, carrier: null };
      return { ok: false, error: String(data.message ?? `Lookup returned ${res.status}`) };
    }
    return {
      ok: true,
      valid: data.valid !== false,
      lineType: data.line_type_intelligence?.type ?? null,
      carrier: data.line_type_intelligence?.carrier_name ?? null,
    };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Roughly what Twilio charges for one line-type lookup. Shown as an estimate. */
export const COST_PER_LOOKUP_USD = 0.005;

/* ------------------------------------------------------------------ cost -- */

/**
 * What one SEGMENT costs, as an estimate shown to staff — never an invoice, and
 * labelled as an estimate everywhere it appears.
 *
 * Two components: Twilio's US outbound list price, plus the A2P 10DLC carrier
 * surcharge that is billed separately and is easy to forget.
 *
 * THE CARRIER FEE WAS TOO LOW. At 0.003 the total ran about 13% under what
 * Twilio actually charged — a figure measured against real invoices, not
 * guessed — which meant every cost shown in the app was optimistic. The
 * surcharge differs per carrier and the church's traffic is a mix, so 0.0044 is
 * the blended rate that reconciles the estimate with the bill.
 *
 * Deliberately rounded so the estimate errs HIGH rather than low. Nobody
 * complains that a bill came in under what they were shown; the reverse is how
 * a church overspends a budget it was watching.
 *
 * If Twilio's pricing changes, this is the one line to edit — every readout in
 * the app derives from it.
 */
export const COST_PER_SEGMENT_USD = 0.0079 + 0.0044;
export const estimateCost = (segments: number) => segments * COST_PER_SEGMENT_USD;
