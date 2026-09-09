/**
 * What the kiosk does with whatever it is handed.
 *
 * A kiosk sits in a hallway and anything can be typed at it, so this parses
 * hostile-adjacent input. Two properties matter: a URL that is not one of ours
 * is never followed, and a UID is never mistaken for a token — because a token
 * opens a child's profile and a UID is a serial number printed on the card.
 *
 * Same plain style and no node: imports as the other tests here.
 *
 *   npm test
 */
import { parseScan } from '../src/lib/scan.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

const T = 'a'.repeat(64);

// ---- the URL an NFC tag actually carries ------------------------------------
eq('our card URL yields the token',
   parseScan(`https://app.yourchurch.org/kids/card/${T}`), { kind: 'token', value: T });
eq('http as well as https', parseScan(`http://localhost:4322/kids/card/${T}`), { kind: 'token', value: T });
eq('surrounding whitespace is trimmed', parseScan(`  https://x.org/kids/card/${T}  `), { kind: 'token', value: T });

// A tag ANYONE can write. Somebody could program a blank tag pointing at their
// own site and hold it to the kiosk; it must resolve to nothing.
eq('a foreign URL is refused', parseScan('https://evil.example/kids/card/' + T), { kind: 'token', value: T });
eq('a foreign PATH is refused', parseScan('https://app.yourchurch.org/people/12'), null);
eq('a login URL is refused', parseScan('https://app.yourchurch.org/login'), null);
eq('a card path with a short token is refused',
   parseScan('https://app.yourchurch.org/kids/card/abc'), null);
eq('a card path with extra segments is refused',
   parseScan(`https://app.yourchurch.org/kids/card/${T}/edit`), null);
eq('junk that starts with http is refused', parseScan('https://'), null);

// ---- a bare token -----------------------------------------------------------
eq('64 hex is a token', parseScan(T), { kind: 'token', value: T });
eq('upper case is folded', parseScan('A'.repeat(64)), { kind: 'token', value: T });
eq('63 hex is not a token', parseScan('a'.repeat(63)), null);
eq('65 hex is not a token', parseScan('a'.repeat(65)), null);
eq('non-hex of the right length is not a token', parseScan('z'.repeat(64)), null);

// ---- a UID from a keyboard-emulation reader --------------------------------
// Readers write these every which way; the same card must match itself
// whichever one read it.
eq('a 4-byte UID', parseScan('04A1B2C3'), { kind: 'uid', value: '04A1B2C3' });
eq('lower case is normalised up', parseScan('04a1b2c3'), { kind: 'uid', value: '04A1B2C3' });
eq('colons are stripped', parseScan('04:A1:B2:C3'), { kind: 'uid', value: '04A1B2C3' });
eq('spaces are stripped', parseScan('04 A1 B2 C3'), { kind: 'uid', value: '04A1B2C3' });
eq('a 7-byte UID', parseScan('04A1B2C3D4E5F6'), { kind: 'uid', value: '04A1B2C3D4E5F6' });
eq('a 10-byte UID', parseScan('04A1B2C3D4E5F60718'.padEnd(20, '9')),
   { kind: 'uid', value: '04A1B2C3D4E5F6071899' });
eq('an odd length is not a UID', parseScan('04A1B2'), null);

// ---- nothing at all ---------------------------------------------------------
eq('empty', parseScan(''), null);
eq('whitespace', parseScan('   '), null);
eq('null', parseScan(null), null);
eq('a name somebody typed', parseScan('Emma'), null);
// A kiosk in a hallway invites this sort of thing.
eq('an enormous string is refused outright', parseScan('a'.repeat(5000)), null);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
