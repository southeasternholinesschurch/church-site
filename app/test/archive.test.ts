/**
 * Archiving people — the id parser, and what the two writes actually set.
 *
 * THE RISK IS A BULK WRITE ACTING ON THE WRONG ROWS. Archiving used to be one
 * person at a time, tapped on a check-in screen; it is now a column of
 * checkboxes and a button that can take a hundred records off every list in the
 * app at once. Between the form post and that write stands one parser, and
 * every coercion JavaScript offers it turns a nonsense value into a real
 * person's id — `Number('')` is 0, `parseInt('1; DROP')` is 1. A parser that
 * shrugs is how the wrong family disappears, so the cases below are mostly
 * rubbish being refused rather than ids being accepted.
 *
 * The second half proves the writes agree with each other. They did not before
 * this: two copies written months apart, one clearing `includeInDirectory` and
 * one not. The writes are driven through a recording stand-in for the database,
 * the same shape lib/consent.ts is tested with — no D1, no bindings, no Worker.
 *
 * Same plain style and no node: imports as the other tests here.
 *
 *   npm test
 */
import { parsePersonIds, archivePeople, restorePeople, chunks, ID_CHUNK } from '../src/lib/archive.ts';
import * as schema from '../src/db/schema.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/* ==== the parser ========================================================= */

eq('ordinary ids come through, in the order they were ticked',
   parsePersonIds(['12', '3', '7']), [12, 3, 7]);

// The confirm step carries the ids as hidden fields; a stray duplicate between
// the two steps must not make the list read "4 people" when it is three.
eq('a repeated id counts once', parsePersonIds(['5', '5', '9', '5']), [5, 9]);

// Whitespace is the browser's, not the user's.
eq('surrounding whitespace is ignored', parsePersonIds([' 41 ', '\t8']), [41, 8]);

/*
 * EVERY ONE OF THESE IS A REAL ID UNDER SOME COERCION. That is the whole point
 * of the list: `Number('')` and `Number('0x10')` and `parseInt('1; DROP')` all
 * produce something a `where id in (...)` would happily act on.
 */
const RUBBISH = ['', '   ', 'abc', '0', '-4', '1.5', '1e3', '0x10', '+7', '007x',
                 '1; DROP TABLE people', 'null', 'undefined', 'NaN', 'Infinity'];
for (const value of RUBBISH) {
  eq(`refused: ${JSON.stringify(value)}`, parsePersonIds([value]), []);
}

// '007' is only leading zeros — a real id spelled oddly, not an attack.
eq('leading zeros are still an id', parsePersonIds(['007']), [7]);

// multipart forms hand back Files. One is not an id and must not become one.
eq('a File entry is not an id',
   parsePersonIds([new File([], 'x.jpg') as unknown as FormDataEntryValue, '6']), [6]);

// Past 2^53 the arithmetic stops being exact, so the value stops being an id.
eq('an id beyond safe integers is refused',
   parsePersonIds(['9007199254740993']), []);

// The caller short-circuits on this rather than issuing `in ()`, which is not
// valid SQL in every dialect and means nothing useful in any of them.
eq('nothing selected is an empty list', parsePersonIds([]), []);
eq('and so is a list of nothing but rubbish', parsePersonIds(['', 'abc']), []);

// A whole church at once is a legitimate thing to do and must not be trimmed.
const many = Array.from({ length: 500 }, (_, i) => String(i + 1));
eq('a long list is not silently truncated', parsePersonIds(many).length, 500);

/* ==== the writes ========================================================= */

/**
 * A stand-in for the database that records what it was asked to write.
 *
 * Drizzle's update builder is chained and then awaited, so this mimics exactly
 * that shape and nothing else.
 */
interface Write { table: unknown; values: Record<string, unknown> }

function recordingDb() {
  const writes: Write[] = [];
  const db = {
    update(table: unknown) {
      return {
        set(values: Record<string, unknown>) {
          return { where(_cond: unknown) { writes.push({ table, values }); return Promise.resolve(); } };
        },
      };
    },
  };
  return { db, writes };
}

{
  const { db, writes } = recordingDb();
  await archivePeople(db as never, [4, 11]);
  eq('archiving writes once, to people', writes.length, 1);
  eq('and only to people', writes[0]!.table === schema.people, true);

  const v = writes[0]!.values;
  eq('the flag is set', v.archived, true);
  /*
   * AND THE DIRECTORY BOX IS CLEARED. This is the half the kids page was
   * missing: archiving somebody who is still marked for the directory leaves
   * their address and photograph in front of the congregation on a page that
   * says they are no longer here.
   */
  eq('and they come out of the directory', v.includeInDirectory, false);
  eq('and the row is stamped', typeof v.updatedAt, 'string');
}

{
  const { db, writes } = recordingDb();
  await restorePeople(db as never, [4]);
  eq('restoring writes once', writes.length, 1);
  eq('the flag is cleared', writes[0]!.values.archived, false);
  /*
   * RESTORING DOES NOT PUT THEM BACK IN THE DIRECTORY, deliberately. Being in
   * it is a consent decision, and this function cannot know what it was before.
   * Guessing "yes" would republish somebody's address off the back of a mis-tap
   * being corrected. Staff tick the box again where it says what it means.
   */
  eq('but the directory box is left alone',
     Object.hasOwn(writes[0]!.values, 'includeInDirectory'), false);
}

/*
 * D1 REFUSES MORE THAN 100 BOUND VALUES A STATEMENT. "Select all shown" can
 * tick 500 people; one `in (...)` with all of them fails outright, so a big
 * selection has to become several writes, none over the limit, none dropped.
 */
eq('chunks split without losing or repeating anyone',
   chunks(Array.from({ length: 250 }, (_, i) => i)).flat().length, 250);
eq('no chunk is over the limit', chunks(Array.from({ length: 250 }, (_, i) => i)).every((c) => c.length <= ID_CHUNK), true);
eq('and the limit leaves room under 100', ID_CHUNK < 100, true);
eq('nothing makes no chunks', chunks([]).length, 0);
{
  const { db, writes } = recordingDb();
  await archivePeople(db as never, Array.from({ length: 250 }, (_, i) => i + 1));
  eq('archiving 250 people is three writes, not one too-big one', writes.length, 3);
}

// THE GUARD. `inArray(col, [])` is a trap: nothing to act on must mean no
// statement at all, not a statement with an empty list in it.
{
  const { db, writes } = recordingDb();
  await archivePeople(db as never, []);
  await restorePeople(db as never, []);
  eq('an empty selection writes nothing at all', writes.length, 0);
}

console.log(fail === 0 ? '\nall passed' : `\n${fail} failed`);
process.exitCode = fail === 0 ? 0 : 1;
