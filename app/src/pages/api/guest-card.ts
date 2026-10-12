import type { APIRoute } from 'astro';
import { readForm } from '../../lib/form';
import { churchDate, readGuestCard, type GuestForm } from '../../lib/care';
import { createGuestCard, recentCardsFrom } from '../../lib/care-db';
import { siteOriginFor } from '../../lib/public-paths';

export const prerender = false;

/**
 * The guest card, posted from the PUBLIC website.
 *
 * A plain form post from a static page on another origin, answered with a
 * redirect back to it — no script, no CORS, and it works on the oldest phone in
 * the building. Public by necessity (see lib/public-paths.ts), and it only ever
 * writes: nothing about any card is ever sent back.
 *
 * SPAM IS ANSWERED WITH THE THANK-YOU PAGE. A bot that is told it was refused
 * learns what to change; one that is thanked moves on. A person who trips a
 * rule by accident (pasting a link into the message, say) is the cost of that,
 * and is small.
 */

/** Cards one connection may send in an hour. A family filling in one each on
 *  one phone is three; a script is hundreds. */
const PER_HOUR = 5;

export const POST: APIRoute = async ({ request, locals }) => {
  const env = locals.runtime.env;
  const form = await readForm(request);
  const field = (k: string) => {
    const v = form.get(k);
    return typeof v === 'string' ? v : undefined;
  };

  const input: GuestForm = {
    first: field('first'), last: field('last'), phone: field('phone'), email: field('email'),
    kind: field('kind'), visitDate: field('visitDate'),
    firstTime: field('firstTime') === 'yes' || field('firstTime') === 'on',
    wants: form.getAll('wants').filter((w): w is string => typeof w === 'string'),
    message: field('message'), party: field('party'), heard: field('heard'),
    sms: field('sms') === 'on',
    website: field('website'),
  };

  const site = siteOriginFor(request.headers.get('origin'), request.headers.get('referer'));
  const page = input.kind === 'planning' ? '/visit' : '/welcome';
  const thanks = `${site}${page}/thanks/`;
  const back = (problem: string) =>
    Response.redirect(`${site}${page}/?problem=${problem}#card`, 303);

  const today = churchDate();
  const read = readGuestCard(input, today);
  if (!read.ok) {
    if (read.problem === 'spam') return Response.redirect(thanks, 303);
    return back(read.problem);
  }

  const ipHash = await hashAddress(request.headers.get('cf-connecting-ip'), today,
                                   env.SMS_CRON_SECRET);
  if (ipHash && (await recentCardsFrom(env, ipHash)) >= PER_HOUR) {
    return Response.redirect(thanks, 303);
  }

  await createGuestCard(env, read.card, ipHash, new URL(request.url).origin);
  return Response.redirect(thanks, 303);
};

/** Somebody opening the address in a browser gets the card, not an error. */
export const GET: APIRoute = ({ request }) =>
  Response.redirect(`${siteOriginFor(null, request.headers.get('referer'))}/welcome/`, 302);

/**
 * The sender's address, made useless for anything but counting.
 *
 * Hashed with the DATE, so a hash cannot be followed from one day to the next,
 * and with a server-side secret, because a bare hash of an IPv4 address can be
 * reversed by simply trying all four billion. The secret borrowed is the cron's
 * — it is only a pepper here, never compared with anything.
 */
async function hashAddress(ip: string | null, day: string, pepper: string | undefined): Promise<string | null> {
  if (!ip) return null;
  const bytes = new TextEncoder().encode(`${ip}|${day}|${pepper ?? ''}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
