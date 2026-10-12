/**
 * Reading Bible references, for "Sermons by Scripture" and the passage search.
 *
 * TWO COPIES OF ONE FILE. site/src/lib/scripture.ts files the sermons and runs
 * the search in the browser; app/src/lib/scripture.ts tells whoever types a
 * passage in the sermon editor how the site will read it. If they ever differ,
 * the editor says one thing and the website does another — so the first test
 * here is that they are the same file, byte for byte.
 *
 * Then the shapes the church's own sermons are written in (every one of these
 * is a real `scripture:` value from the archive), the shapes people type, and
 * the ones that must NOT be read as a passage.
 *
 *   npm test
 */
import { readFileSync } from 'node:fs';
import { readScripture, parseScripture, formatPassage, overlaps, findBook, BOOKS } from '../src/lib/scripture.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

const app = readFileSync(new URL('../src/lib/scripture.ts', import.meta.url), 'utf8');
const site = readFileSync(new URL('../../site/src/lib/scripture.ts', import.meta.url), 'utf8');
eq('THE APP AND THE SITE READ PASSAGES WITH THE SAME FILE', app === site, true);

eq('sixty-six books', BOOKS.length, 66);
eq('thirty-nine of them old', BOOKS.filter((b) => b.testament === 'old').length, 39);
eq('a book by any name', findBook('1 Cor')?.name, '1 Corinthians');

const read = (s: string) => parseScripture(s).map(formatPassage);

/* ==== the archive's own ===================================================== */

for (const [typed, want] of [
  ['Micah 6', ['Micah 6']],
  ['1 Corinthians 10', ['1 Corinthians 10']],
  ['Proverbs 27:17', ['Proverbs 27:17']],
  ['John 12:20-25', ['John 12:20–25']],
  ['I Corinthians 12:1-10', ['1 Corinthians 12:1–10']],
  ['Psalm 85:6', ['Psalm 85:6']],
  ['Isaiah 63:15-64:2', ['Isaiah 63:15–64:2']],
  ['Revelation 4:1-11; 5:11-14', ['Revelation 4:1–11', 'Revelation 5:11–14']],
  ['Ecclesiastes 3:1-14', ['Ecclesiastes 3:1–14']],
] as const) {
  eq(`reads "${typed}"`, read(typed), want);
}

/* ==== the ways people type them ============================================== */

eq('dots and an en dash', read('1 Cor. 12:1–10'), ['1 Corinthians 12:1–10']);
eq('no space after the number', read('1Cor 12'), ['1 Corinthians 12']);
eq('a written-out number', read('First John 4:8'), ['1 John 4:8']);
eq('a Roman numeral', read('III John 4'), ['3 John 4']);
eq('a one-chapter book by verse', read('Jude 3'), ['Jude 3']);
eq('and the same with its chapter written', read('Philemon 1:4-7'), ['Philemon 4–7']);
eq('an abbreviation', read('Phil 4:13'), ['Philippians 4:13']);
eq('another name for a book', read('Song of Songs 2:4'), ['Song of Solomon 2:4']);
eq('one psalm is a Psalm', read('Ps 23'), ['Psalm 23']);
eq('a comma keeps the chapter', read('John 3:16, 18'), ['John 3:16', 'John 3:18']);
eq('a semicolon does not', read('John 3:16; 18'), ['John 3:16', 'John 18']);
eq('a new book after a comma', read('Psalm 23, John 10'), ['Psalm 23', 'John 10']);
eq('"and" is a comma', read('Exodus 20 and 21'), ['Exodus 20', 'Exodus 21']);
eq('across a chapter', read('Gen 1:1-2:3'), ['Genesis 1:1–2:3']);
eq('a part-verse is the verse', read('Romans 8:28a'), ['Romans 8:28']);
eq('a book on its own is the book', read('Hebrews'), ['Hebrews']);

/* ==== and what is not a passage ============================================== */

eq('a chapter the book does not have', readScripture('John 99'), { passages: [], unread: ['John 99'] });
eq('a word that starts with a book', readScripture('Johnson 3'), { passages: [], unread: ['Johnson 3'] });
eq('numbers with no book', readScripture('3:16').unread, ['3:16']);
eq('a backwards range', readScripture('John 3:18-16').passages, []);
eq('nothing is nothing', readScripture(''), { passages: [], unread: [] });
eq('"I am" is not first Amos', read('I am'), []);

/* ==== finding "John 3" inside "John 3:1-21" ================================= */

const one = (s: string) => parseScripture(s)[0]!;
eq('a verse inside a range', overlaps(one('John 3:16'), one('John 3:1-21')), true);
eq('a chapter holds its verses', overlaps(one('John 3'), one('John 3:16')), true);
eq('a range across chapters', overlaps(one('Isaiah 64'), one('Isaiah 63:15-64:2')), true);
eq('the next chapter does not', overlaps(one('John 4'), one('John 3:1-21')), false);
eq('nor another book', overlaps(one('1 John 3'), one('John 3')), false);
eq('a whole book holds everything in it', overlaps(one('Matthew'), one('Matthew 6:9-13')), true);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
