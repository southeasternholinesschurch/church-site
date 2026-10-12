/**
 * Reading Bible references the way people write them.
 *
 *   "John 3:16"   "1 Cor 12:1-10"   "I Corinthians 12:1–10"   "Psalm 23"
 *   "Revelation 4:1-11; 5:11-14"   "Isaiah 63:15-64:2"   "Matthew 6"   "Jude 3"
 *
 * Used to put sermons under the book they preach from (/sermons/scripture), to
 * let the archive search find "John 3" inside "John 3:1-21", and — in the staff
 * app — to show whoever is typing a passage how the site will read it.
 *
 * THERE ARE TWO COPIES OF THIS FILE, ON PURPOSE: this one, and
 * app/src/lib/scripture.ts. The app bundles for Workers and the site for the
 * browser, and the project keeps each half importing only from itself. The two
 * must be IDENTICAL — app/test/scripture.test.ts fails the moment they are not.
 * Edit one, copy it over the other.
 *
 * No imports, no Node, no DOM: it runs in the build, in a browser, in a Worker
 * and in the tests unchanged.
 *
 * Chapter counts are the King James Version's, which is what this church reads
 * (Joel has three chapters and Malachi four there, not four and three).
 */

export interface Book {
  /** 0–65, canonical order. Also what passages store. */
  id: number;
  name: string;
  /** For a URL fragment: "1-corinthians". */
  slug: string;
  testament: 'old' | 'new';
  chapters: number;
}

/* name, chapters, other ways of writing it (lower case, no dots). Numbered
 * books list their base word once; "1", "I", "First", "1st" are handled below. */
const RAW: [string, number, string[]][] = [
  ['Genesis', 50, ['gen', 'ge', 'gn']],
  ['Exodus', 40, ['exod', 'exo', 'ex']],
  ['Leviticus', 27, ['lev', 'le', 'lv']],
  ['Numbers', 36, ['num', 'nu', 'nm', 'numb']],
  ['Deuteronomy', 34, ['deut', 'deu', 'de', 'dt']],
  ['Joshua', 24, ['josh', 'jos']],
  ['Judges', 21, ['judg', 'jdg', 'jdgs']],
  ['Ruth', 4, ['rth', 'ru']],
  ['1 Samuel', 31, ['samuel', 'sam', 'sa', 'sm']],
  ['2 Samuel', 24, ['samuel', 'sam', 'sa', 'sm']],
  ['1 Kings', 22, ['kings', 'kgs', 'kg', 'ki']],
  ['2 Kings', 25, ['kings', 'kgs', 'kg', 'ki']],
  ['1 Chronicles', 29, ['chronicles', 'chron', 'chr', 'ch']],
  ['2 Chronicles', 36, ['chronicles', 'chron', 'chr', 'ch']],
  ['Ezra', 10, ['ezr']],
  ['Nehemiah', 13, ['neh', 'ne']],
  ['Esther', 10, ['esth', 'est', 'es']],
  ['Job', 42, ['jb']],
  ['Psalms', 150, ['psalm', 'ps', 'psa', 'pss', 'psm']],
  ['Proverbs', 31, ['prov', 'pro', 'prv', 'pr']],
  ['Ecclesiastes', 12, ['eccl', 'eccles', 'ecc', 'ec', 'qoh']],
  ['Song of Solomon', 8, ['song of songs', 'song of sol', 'song', 'sos', 'canticles', 'canticle of canticles']],
  ['Isaiah', 66, ['isa', 'is']],
  ['Jeremiah', 52, ['jer', 'je', 'jr']],
  ['Lamentations', 5, ['lam', 'la']],
  ['Ezekiel', 48, ['ezek', 'eze', 'ezk']],
  ['Daniel', 12, ['dan', 'da', 'dn']],
  ['Hosea', 14, ['hos', 'ho']],
  ['Joel', 3, ['jl']],
  ['Amos', 9, ['am']],
  ['Obadiah', 1, ['obad', 'ob']],
  ['Jonah', 4, ['jon', 'jnh']],
  ['Micah', 7, ['mic', 'mc']],
  ['Nahum', 3, ['nah', 'na']],
  ['Habakkuk', 3, ['hab', 'hb']],
  ['Zephaniah', 3, ['zeph', 'zep', 'zp']],
  ['Haggai', 2, ['hag', 'hg']],
  ['Zechariah', 14, ['zech', 'zec', 'zc']],
  ['Malachi', 4, ['mal', 'ml']],
  ['Matthew', 28, ['matt', 'mat', 'mt']],
  ['Mark', 16, ['mrk', 'mar', 'mk', 'mr']],
  ['Luke', 24, ['luk', 'lk']],
  ['John', 21, ['jn', 'jhn', 'joh']],
  ['Acts', 28, ['acts of the apostles', 'act', 'ac']],
  ['Romans', 16, ['rom', 'ro', 'rm']],
  ['1 Corinthians', 16, ['corinthians', 'cor', 'co']],
  ['2 Corinthians', 13, ['corinthians', 'cor', 'co']],
  ['Galatians', 6, ['gal', 'ga']],
  ['Ephesians', 6, ['eph', 'ephes']],
  ['Philippians', 4, ['phil', 'php', 'pp']],
  ['Colossians', 4, ['col']],
  ['1 Thessalonians', 5, ['thessalonians', 'thess', 'thes', 'th']],
  ['2 Thessalonians', 3, ['thessalonians', 'thess', 'thes', 'th']],
  ['1 Timothy', 6, ['timothy', 'tim', 'ti']],
  ['2 Timothy', 4, ['timothy', 'tim', 'ti']],
  ['Titus', 3, ['tit']],
  ['Philemon', 1, ['philem', 'phm', 'pm']],
  ['Hebrews', 13, ['heb']],
  ['James', 5, ['jas', 'jm']],
  ['1 Peter', 5, ['peter', 'pet', 'pe', 'pt']],
  ['2 Peter', 3, ['peter', 'pet', 'pe', 'pt']],
  ['1 John', 5, ['john', 'jn', 'jhn', 'joh']],
  ['2 John', 1, ['john', 'jn', 'jhn', 'joh']],
  ['3 John', 1, ['john', 'jn', 'jhn', 'joh']],
  ['Jude', 1, ['jud']],
  ['Revelation', 22, ['revelations', 'rev', 're', 'the revelation', 'revelation of john']],
];

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const BOOKS: Book[] = RAW.map(([name, chapters], id) => ({
  id, name, slug: slugify(name), testament: id < 39 ? 'old' : 'new', chapters,
}));

/** A Bible book by its id, slug or any way of writing its name. */
export function findBook(text: string): Book | null {
  const key = norm(text);
  const hit = NAMES.find((n) => n.key === key);
  return hit ? BOOKS[hit.id]! : null;
}

/* Every way of writing every book, longest first so "song of songs" beats
 * "song" and "1 john" is tried before "john". */
const NUMBER_WORDS: Record<string, string> = {
  '1': '1', i: '1', first: '1', '1st': '1',
  '2': '2', ii: '2', second: '2', '2nd': '2',
  '3': '3', iii: '3', third: '3', '3rd': '3',
};

const norm = (s: string) => s.toLowerCase().replace(/\./g, ' ').replace(/\s+/g, ' ').trim();

const NAMES: { key: string; id: number }[] = (() => {
  const out: { key: string; id: number }[] = [];
  RAW.forEach(([name, , aliases], id) => {
    const m = /^([123]) (.+)$/.exec(name);
    if (m) {
      const n = m[1]!;
      for (const base of [norm(m[2]!), ...aliases]) {
        for (const [word, num] of Object.entries(NUMBER_WORDS)) {
          if (num !== n) continue;
          out.push({ key: `${word} ${base}`, id });
          // "1Cor", "1cor" — no space after a digit is common.
          if (/^\d/.test(word)) out.push({ key: `${word}${base}`, id });
        }
      }
    } else {
      for (const k of [norm(name), ...aliases]) out.push({ key: k, id });
    }
  });
  return out.sort((a, b) => b.key.length - a.key.length);
})();

/* --------------------------------------------------------------- passages -- */

/** A verse of 0 means "from the start of the chapter"; 999, "to its end". */
export interface Passage {
  book: number;
  from: { c: number; v: number | null };
  to: { c: number; v: number | null };
}

/** A passage as two comparable numbers within its book: chapter * 1000 + verse. */
export function span(p: Passage): [number, number] {
  return [p.from.c * 1000 + (p.from.v ?? 0), p.to.c * 1000 + (p.to.v ?? 999)];
}

export function overlaps(a: Passage, b: Passage): boolean {
  if (a.book !== b.book) return false;
  const [a1, a2] = span(a), [b1, b2] = span(b);
  return a1 <= b2 && b1 <= a2;
}

/**
 * Every passage a piece of text names, and anything it could not read.
 *
 * Forgiving about how it is written — dots, spaces, "–" or "-", Roman numerals,
 * "First" — and strict about what it means: a chapter the book does not have is
 * not a passage, because a sermon filed under "John 99" is a sermon filed
 * nowhere a person would look.
 *
 * The separators mean what they mean in print:
 *   ";"  the book carries on, the chapter does not — "Revelation 4:1-11; 5:11-14"
 *   ","  the chapter carries on too — "John 3:16, 18" is two verses of John 3
 *   a new book name starts again anywhere — "Psalm 23, John 10"
 */
export function readScripture(text: string | null | undefined): { passages: Passage[]; unread: string[] } {
  const passages: Passage[] = [];
  const unread: string[] = [];
  let book: Book | null = null;
  let chapter: number | null = null;

  const parts = String(text ?? '')
    .replace(/[\u2010-\u2015\u2212]/g, '-')        // every dash is a range
    .replace(/\s+(?:to|through|thru)\s+/gi, '-')   // "1 to 4"
    .split(/(;|,|\band\b)/i);

  let sep = ';';
  for (let i = 0; i < parts.length; i += 2) {
    const raw = (parts[i] ?? '').trim();
    if (raw) {
      const named = leadingBook(raw);
      if (named) { book = named.book; chapter = null; }
      else if (sep === ';') chapter = null;
      const read: Piece | null = book
        ? readPiece(book, named ? named.rest : norm(raw), chapter, Boolean(named)) : null;
      if (!read) unread.push(raw);
      else { passages.push(read.passage); chapter = read.chapter; }
    }
    sep = (parts[i + 1] ?? ';') === ';' ? ';' : ',';
  }
  return { passages, unread };
}

/** Just the passages — for indexing, where anything unread is simply left out. */
export function parseScripture(text: string | null | undefined): Passage[] {
  return readScripture(text).passages;
}

function leadingBook(seg: string): { book: Book; rest: string } | null {
  const s = norm(seg);
  for (const n of NAMES) {
    if (!s.startsWith(n.key)) continue;
    const after = s.slice(n.key.length);
    // The name must end at a word boundary — "Johnson 3" is not John.
    if (after && !/^[\s\d:]/.test(after)) continue;
    return { book: BOOKS[n.id]!, rest: after.trim() };
  }
  return null;
}

/**
 * The numbers in one piece: "3:16-18", "63:15-64:2", "6", or nothing at all.
 * `chapter` is the chapter a bare number belongs to after "3:16," — null when
 * a bare number is a chapter of its own. Returns null when the piece cannot be
 * read, so the caller can say which part was not understood.
 */
type Piece = { passage: Passage; chapter: number | null };

function readPiece(book: Book, raw: string, chapter: number | null, named: boolean): Piece | null {
  const s = raw
    .replace(/^ch(?:apter)?s?\s*/i, '')
    .replace(/\s*(?:verses?|vv?)\s*/gi, ':')   // "chapter 3 verse 16"
    .replace(/\s*([:-])\s*/g, '$1')
    .replace(/(\d)[ab]\b/g, '$1')             // "3:16a" is still verse 16
    .trim();
  // A book on its own is the whole book.
  if (!s) {
    return named
      ? { passage: { book: book.id, from: { c: 1, v: null }, to: { c: book.chapters, v: null } }, chapter: null }
      : null;
  }
  const m = /^(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/.exec(s);
  if (!m) return null;
  const [a, b, c, d] = [m[1], m[2], m[3], m[4]].map((x) => (x === undefined ? null : Number(x)));
  let p: Passage;
  let next: number | null = chapter;
  if (b !== null) {
    // 3:16   3:16-18   63:15-64:2
    p = d !== null
      ? { book: book.id, from: { c: a!, v: b }, to: { c: c!, v: d } }
      : { book: book.id, from: { c: a!, v: b }, to: { c: a!, v: c ?? b } };
    next = p.to.c;
  } else if (chapter !== null) {
    // after "3:16," a bare number is another verse in the same chapter
    p = { book: book.id, from: { c: chapter, v: a }, to: { c: chapter, v: c ?? a } };
  } else if (book.chapters === 1) {
    // Jude 3, Philemon 4-7: a one-chapter book is cited by verse alone
    p = { book: book.id, from: { c: 1, v: a }, to: { c: 1, v: c ?? a } };
    next = 1;
  } else {
    // 6   1-3   (whole chapters)
    p = { book: book.id, from: { c: a!, v: null }, to: { c: c ?? a!, v: null } };
  }
  return valid(book, p) ? { passage: p, chapter: next } : null;
}

function valid(book: Book, p: Passage): boolean {
  const { from, to } = p;
  if (from.c < 1 || to.c > book.chapters || to.c < from.c) return false;
  if (from.v !== null && from.v < 1) return false;
  if (to.v !== null && to.v < 1) return false;
  if (from.c === to.c && from.v !== null && to.v !== null && to.v < from.v) return false;
  return true;
}

/* ---------------------------------------------------------------- writing -- */

const DASH = '–';

/** "John 3:16–18", "Isaiah 63:15–64:2", "Psalm 23", "Psalms 1–2", "Jude 3". */
export function formatPassage(p: Passage): string {
  const b = BOOKS[p.book]!;
  const wholeBook = p.from.c === 1 && p.from.v === null && p.to.c === b.chapters && p.to.v === null;
  if (wholeBook) return b.name;
  // One psalm is a Psalm.
  const name = b.name === 'Psalms' && p.from.c === p.to.c ? 'Psalm' : b.name;
  const single = b.chapters === 1;
  const at = (c: number, v: number | null) => (v === null ? `${c}` : single ? `${v}` : `${c}:${v}`);
  if (p.from.v === null && p.to.v === null) {
    return p.from.c === p.to.c ? `${name} ${p.from.c}` : `${name} ${p.from.c}${DASH}${p.to.c}`;
  }
  if (p.from.c === p.to.c) {
    if (p.from.v === p.to.v) return `${name} ${at(p.from.c, p.from.v)}`;
    return `${name} ${at(p.from.c, p.from.v)}${DASH}${p.to.v}`;
  }
  return `${name} ${at(p.from.c, p.from.v)}${DASH}${at(p.to.c, p.to.v)}`;
}

/** Book order, then chapter and verse — the order a Bible reads in. */
export function comparePassages(a: Passage, b: Passage): number {
  return a.book - b.book || span(a)[0] - span(b)[0] || span(a)[1] - span(b)[1];
}
