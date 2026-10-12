/**
 * Structured data for LOCAL SEARCH — telling Google, in its own vocabulary,
 * that this site is a church, where it is, and how to reach it.
 *
 * Built from Settings, the same facts the footer prints, so the address a
 * search engine reads and the address a visitor reads cannot disagree. That
 * consistency is most of what local search rewards: the same name, address and
 * phone number everywhere the church appears — this site, the Google Business
 * Profile, Facebook, Apple Maps. docs/README.md → "Local search" has the
 * half of this that is not code.
 *
 * Deliberately NOT here: opening hours or "events" for the weekly services.
 * Google does not use either for a church, and service times expressed as
 * opening hours tell it the building is open only then, which is untrue on a
 * Tuesday when somebody rings the office. The times are in the page text,
 * where search reads them, and belong in the Business Profile.
 */

interface Settings {
  churchName: string;
  address: string;
  mapsUrl: string;
  email: string;
  phone?: string;
  socials: { facebook?: string; instagram?: string; youtubeUrl: string };
}

/** "412 Meadowbrook Road, Fairhaven, IN 46140" -> its parts, or null. */
export function postalAddress(address: string) {
  const m = /^(.+?),\s*([^,]+?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(address.trim());
  if (!m) return null;
  return {
    '@type': 'PostalAddress',
    streetAddress: m[1],
    addressLocality: m[2],
    addressRegion: m[3],
    postalCode: m[4],
    addressCountry: 'US',
  };
}

/** "(317) 555-0142" -> "+1-317-555-0142". */
function e164ish(phone: string | undefined): string | undefined {
  const d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 10) return `+1-${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return phone || undefined;
}

/**
 * The church, as schema.org/Church. Used on the home page and Plan Your Visit.
 *
 * `photo` is a picture of the building, which is what a map listing shows;
 * the logo stands in when a page has none to hand.
 */
export function churchJsonLd(s: Settings, site: URL | undefined, photo?: string) {
  const base = site?.href ?? '/';
  const url = (p: string) => new URL(p, base).href;
  return {
    '@context': 'https://schema.org',
    '@type': 'Church',
    '@id': `${url('/')}#church`,
    name: s.churchName,
    url: url('/'),
    logo: url('/icons/icon-512.png'),
    image: photo ? url(photo) : url('/icons/icon-512.png'),
    address: postalAddress(s.address) ?? s.address,
    hasMap: s.mapsUrl,
    ...(e164ish(s.phone) ? { telephone: e164ish(s.phone) } : {}),
    email: s.email,
    sameAs: [s.socials.facebook, s.socials.instagram, s.socials.youtubeUrl].filter(Boolean),
  };
}

/**
 * The site itself. Google reads WebSite.name for the name it prints above a
 * search result — without it, results can show the bare domain.
 */
export function websiteJsonLd(s: Settings, site: URL | undefined) {
  const home = new URL('/', site?.href ?? '/').href;
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: s.churchName,
    alternateName: s.churchName.replace(/\s+Church$/i, ''),
    url: home,
    publisher: { '@id': `${home}#church` },
  };
}
