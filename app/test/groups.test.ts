/**
 * Adding many people to a texting group at once.
 *
 * THE RISK IS THE WRONG LIST. The bar on the People tab takes a dropdown OR a
 * typed name for a new group; reading the two wrongly would put forty people in
 * a group nobody chose. So the parser refuses anything ambiguous rather than
 * picking, and the cases below are mostly refusals.
 *
 * The second half proves big selections are split under D1's 100-value limit.
 *
 * Same plain style and no node: imports as the other tests here.
 *
 *   npm test
 */
import { parseGroupTarget, addToGroup, removeFromGroup, MAX_GROUP_NAME } from '../src/lib/groups.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};
const isError = (r: ReturnType<typeof parseGroupTarget>) => 'error' in r;

/* ==== which group ======================================================== */

eq('a chosen group', parseGroupTarget('7', ''), { target: { kind: 'existing', id: 7 } });
eq('a typed new name', parseGroupTarget('', '  Fairhaven Youth   parents '), { target: { kind: 'new', name: 'Fairhaven Youth parents' } });
eq('both at once is refused, not guessed', isError(parseGroupTarget('7', 'Choir')), true);
eq('neither is refused', isError(parseGroupTarget('', '   ')), true);
for (const bad of ['0', '-3', '1.5', 'abc', '7; DROP', '0x10']) {
  eq(`not a group id: ${JSON.stringify(bad)}`, isError(parseGroupTarget(bad, '')), true);
}
eq('a File is not a choice', isError(parseGroupTarget(new File([], 'x') as unknown, '')), true);
eq('a name too long is refused', isError(parseGroupTarget('', 'x'.repeat(MAX_GROUP_NAME + 1))), true);
eq('a name at the limit is fine', isError(parseGroupTarget('', 'x'.repeat(MAX_GROUP_NAME))), false);

/* ==== the writes ========================================================= */

/** Records each insert's row count and each delete. Mimics only the chained
 *  shapes the two functions use. */
function recordingDb() {
  const inserts: number[] = [];
  let deletes = 0;
  const db = {
    insert(_t: unknown) {
      return { values(rows: unknown[]) {
        return { onConflictDoNothing() { inserts.push(rows.length); return Promise.resolve(); } };
      } };
    },
    delete(_t: unknown) {
      return { where(_c: unknown) { deletes++; return Promise.resolve(); } };
    },
  };
  return { db, inserts, deletes: () => deletes };
}

{
  const { db, inserts } = recordingDb();
  await addToGroup(db as never, 3, Array.from({ length: 200 }, (_, i) => i + 1));
  eq('200 people are all added', inserts.reduce((a, b) => a + b, 0), 200);
  // Two values bound per row (person, group): 45 rows is 90 values.
  eq('no insert binds more than 100 values', inserts.every((n) => n * 2 <= 100), true);
}
{
  const { db, inserts } = recordingDb();
  await addToGroup(db as never, 3, []);
  eq('adding nobody writes nothing', inserts.length, 0);
}
{
  const { db, deletes } = recordingDb();
  await removeFromGroup(db as never, 3, Array.from({ length: 200 }, (_, i) => i + 1));
  eq('removing 200 is split into statements under the limit', deletes(), 3);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
