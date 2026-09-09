/**
 * Demo mode — real layout, real counts, invented people.
 *
 * Add `?demo=1` to any staff page and every name, phone number, street address
 * and email is replaced with a plausible fake one. Nothing is written; this is
 * purely a display transform on the way out, so there is no way for it to
 * corrupt anything.
 *
 * It exists so the app can be screenshotted for people who are not in this
 * church — a landing page, a walkthrough, a conversation with another pastor.
 * The alternative is blurring, which looks redacted, has to be redone every
 * time the interface changes, and only has to be got wrong once.
 *
 * WHAT IS NOT FAKED, deliberately:
 *  - counts, dates and totals, so the screenshots tell the truth about scale
 *  - birthdays and anniversaries: a month and a day beside an invented name
 *    identifies nobody, and the bulletin's celebration list has to look real
 *  - photographs, which are the church's own and consented to
 */

const FIRST = [
  'Marcus','Eleanor','Daniel','Ruth','Samuel','Miriam','Caleb','Naomi','Silas',
  'Hannah','Josiah','Lydia','Aaron','Priscilla','Simon','Abigail','Levi','Esther',
  'Amos','Tabitha','Gideon','Rhoda','Ezra','Joanna','Titus','Phoebe','Enoch',
  'Damaris','Barnabas','Salome','Reuben','Keturah','Asher','Dorcas','Jonah','Anna',
];
const LAST = [
  'Whitfield','Barlow','Hargrove','Ashworth','Pennington','Calloway','Redmond',
  'Thackery','Milburn','Ellison','Stanfield','Braddock','Ainsworth','Fairbanks',
  'Holloway','Winslow','Kirkland','Danforth','Ravenel','Sutcliffe','Marchetti',
  'Alderidge','Beaumont','Carrington',
];
const STREETS = [
  'Willow Bend Dr.','Rosewood Ave.','Chapel Hill Rd.','Maple Ridge Ln.',
  'Sycamore St.','Bellview Ct.','Orchard Way','Kingsley Dr.','Meadowlark Ln.',
  'Fairmount Ave.','Hawthorne St.','Cedar Crest Rd.',
];
const CITIES = [
  ['Fairmont', '46140'], ['Ridgeway', '46203'], ['Lakemont', '46176'],
  ['Brookfield', '46107'], ['Westbury', '46239'],
];

/** Deterministic, so the same person is the same invented person everywhere.
 *  The directory and the People list showing different fake names for the same
 *  row would look like a bug in a screenshot. */
function hash(n: number, salt: number): number {
  let h = (n * 2654435761 + salt * 40503) >>> 0;
  h ^= h >>> 15;
  return h >>> 0;
}

/** A stable number from a string, so a household can be keyed off its address. */
function strHash(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

/**
 * One invented person, derived only from their id and their household.
 *
 * The SURNAME and the address both key off the real address rather than the
 * person id, so a household stays a household. Keying the surname off the id
 * turned Marguerite and Wendell Ashdown into two different surnames at one address, which
 * reads as a bug the moment anybody looks at a screenshot of the directory.
 * Somebody with no address is a household of one.
 */
function fakeIdentity(id: number, addressStreet?: string | null) {
  const addrSeed = addressStreet ? strHash(addressStreet.trim().toLowerCase()) : hash(id, 9);
  const [city, zip] = CITIES[hash(addrSeed, 4) % CITIES.length];
  return {
    first: FIRST[hash(id, 1) % FIRST.length],
    last: LAST[hash(addrSeed, 2) % LAST.length],
    street: STREETS[hash(addrSeed, 3) % STREETS.length],
    city, zip,
    // 555-01xx is the range reserved for fiction. Never a real handset.
    line: 100 + (hash(id, 5) % 99),
    addrSeed,
  };
}

export interface DemoPerson {
  firstName?: string | null; lastName?: string | null;
  phone?: string | null; phoneE164?: string | null; email?: string | null;
  addressStreet?: string | null; addressCity?: string | null;
  addressState?: string | null; addressZip?: string | null;
}

/**
 * Swap one person's identifying fields. Everything else is left alone.
 *
 * A field that was EMPTY stays empty — a person with no address on file must
 * still show as having no address, or the screenshots would misrepresent how
 * complete the data is, which is one of the things the People list exists to
 * show.
 */
export function demoPerson<T extends DemoPerson>(p: T, id: number, on: boolean): T {
  if (!on) return p;
  const { first, last, street, city, zip, line, addrSeed } = fakeIdentity(id, p.addressStreet);
  return {
    ...p,
    firstName: p.firstName ? first : p.firstName,
    lastName: p.lastName ? last : p.lastName,
    phone: p.phone ? `(317) 555-0${line}` : p.phone,
    phoneE164: p.phoneE164 ? `+13175550${line}` : p.phoneE164,
    email: p.email ? `${first.toLowerCase()}.${last.toLowerCase()}@example.org` : p.email,
    addressStreet: p.addressStreet ? `${1000 + (hash(addrSeed, 6) % 8999)} ${street}` : p.addressStreet,
    addressCity: p.addressCity ? city : p.addressCity,
    addressState: p.addressState ? 'IN' : p.addressState,
    addressZip: p.addressZip ? zip : p.addressZip,
  };
}

/**
 * A bare name string, for the places that hold "First Last" rather than fields.
 *
 * Takes the household key so it agrees with demoPerson. It did not, briefly:
 * the surname moved to being address-derived and this was left keyed off the id,
 * so the same person had two different surnames on two pages. Both now go
 * through fakeIdentity, which is the only way to keep them from drifting apart
 * again.
 */
export function demoName(id: number, on: boolean, real: string, addressStreet?: string | null): string {
  if (!on) return real;
  const f = fakeIdentity(id, addressStreet);
  return `${f.first} ${f.last}`;
}

/** Inbound texts can say anything at all, so they are replaced outright. */
const REPLIES = [
  'Thank you pastor, we will be there Sunday.',
  'Please pray for my mother, she goes in for surgery Tuesday.',
  'Got it, thank you!',
  'We are travelling this week but will be back next Sunday.',
  'Can you send me the address for the picnic?',
  'Praise the Lord. Thank you for the reminder.',
];
export function demoBody(id: number, on: boolean, real: string): string {
  return on ? REPLIES[hash(id, 7) % REPLIES.length] : real;
}

/**
 * Is demo mode on for this request?
 *
 * Staff only, and read from the URL rather than stored — it cannot be left
 * switched on by accident, and a member following a directory link can never
 * land in it.
 */
export function demoOn(url: URL, user: unknown): boolean {
  return Boolean(user) && url.searchParams.get('demo') === '1';
}
