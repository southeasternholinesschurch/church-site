/**
 * The constant-time secret compare guarding /api/sms/run-due.
 *
 * Correctness first — a "secure" comparison that returns true for the wrong
 * secret is worse than the naive one it replaced. The timing property itself
 * is not asserted here: a wall-clock test on a shared CI runner is noise, and
 * a flaky security test gets deleted. What is asserted is that the function
 * never accepts anything it should not, including the two cases that are easy
 * to get wrong — empty vs empty, and a prefix of the real secret.
 *
 *   npm test
 */
import { secretsMatch } from '../src/lib/constant-time.ts';

let fail = 0;
const eq = async (label: string, got: Promise<unknown> | unknown, want: unknown) => {
  const v = await got;
  const ok = JSON.stringify(v) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(46)} got ${JSON.stringify(v)}${ok ? '' : `  want ${JSON.stringify(want)}`}`);
};

const SECRET = 'a-real-looking-cron-secret-9f3c2b';

console.log('constant-time secret compare');
await eq('exact match',              secretsMatch(SECRET, SECRET), true);
await eq('wrong secret',             secretsMatch('nope', SECRET), false);
await eq('prefix of the real one',   secretsMatch(SECRET.slice(0, -1), SECRET), false);
await eq('one byte different',       secretsMatch(SECRET.slice(0, -1) + 'c', SECRET), false);
await eq('longer than the real one', secretsMatch(SECRET + 'x', SECRET), false);
await eq('case differs',             secretsMatch(SECRET.toUpperCase(), SECRET), false);

console.log('\nabsent secrets never authorise');
await eq('empty presented',   secretsMatch('', SECRET), false);
await eq('empty expected',    secretsMatch(SECRET, ''), false);
await eq('both empty',        secretsMatch('', ''), false);
await eq('null presented',    secretsMatch(null, SECRET), false);
await eq('undefined expected', secretsMatch(SECRET, undefined), false);
await eq('both missing',      secretsMatch(null, undefined), false);

console.log('\nunicode and length extremes still compare correctly');
await eq('unicode equal',   secretsMatch('sécret-✓', 'sécret-✓'), true);
await eq('unicode differs', secretsMatch('sécret-✓', 'secret-✓'), false);
await eq('very long equal', secretsMatch('z'.repeat(4096), 'z'.repeat(4096)), true);
await eq('long vs short',   secretsMatch('z'.repeat(4096), 'z'), false);

console.log(fail ? `\n${fail} FAILING` : '\nall passing');
process.exit(fail ? 1 : 0);
