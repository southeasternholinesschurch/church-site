/**
 * [Kids Currency] arithmetic and the amounts people type.
 *
 * Play money, so nothing here is a security boundary — but a balance a child
 * disputes has to be answerable, and the two ways this goes wrong are a typed
 * amount that means the opposite of what was intended, and a stored setting
 * that quietly stops every child earning.
 *
 * Same plain style and no node: imports as the other tests here.
 *
 *   npm test
 */
import { balanceOf, parseAmount, parsePerVisit, MAX_AMOUNT, DEFAULT_PER_VISIT }
  from '../src/lib/bucks.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

// ---- balanceOf --------------------------------------------------------------
eq('nothing earned is nothing', balanceOf([]), 0);
eq('one credit', balanceOf([{ delta: 5 }]), 5);
eq('credits and spending', balanceOf([{ delta: 5 }, { delta: 5 }, { delta: -8 }]), 2);
// A child CAN go negative if somebody corrects a mistake after they spent. The
// screen should show it rather than clamp to zero and hide the problem.
eq('a correction can take it below zero', balanceOf([{ delta: 5 }, { delta: -8 }]), -3);
eq('a long history still sums',
   balanceOf(Array.from({ length: 40 }, () => ({ delta: 5 })).concat([{ delta: -100 }])), 100);

// ---- parseAmount ------------------------------------------------------------
eq('a plain number', parseAmount('5'), 5);
eq('spaces are trimmed', parseAmount('  12  '), 12);
eq('the cap is allowed', parseAmount(String(MAX_AMOUNT)), MAX_AMOUNT);
eq('above the cap is refused', parseAmount(String(MAX_AMOUNT + 1)), null);

// Direction comes from the BUTTON, never from a minus sign. Accepting "-5" in
// the spend box would silently award five instead of taking them.
eq('a negative is refused', parseAmount('-5'), null);
eq('zero is refused', parseAmount('0'), null);
eq('a decimal is refused', parseAmount('2.5'), null);
eq('empty is refused', parseAmount(''), null);
eq('null is refused', parseAmount(null), null);
eq('words are refused', parseAmount('five'), null);
eq('a number with a word is refused', parseAmount('5 bucks'), null);
// Would parse as 5 under Number(), which is exactly the trap.
eq('leading plus is refused', parseAmount('+5'), null);
eq('whitespace only is refused', parseAmount('   '), null);

// ---- parsePerVisit ----------------------------------------------------------
eq('a stored number is used', parsePerVisit('10'), 10);
// ZERO is a real setting: attendance alone earns nothing.
eq('zero is a real answer, not a fallback', parsePerVisit('0'), 0);
// Anything unusable degrades to the default rather than to silence — a credit
// of NaN would stop every child earning and nothing would say so.
eq('junk falls back', parsePerVisit('lots'), DEFAULT_PER_VISIT);
eq('empty falls back', parsePerVisit(''), DEFAULT_PER_VISIT);
eq('missing falls back', parsePerVisit(undefined), DEFAULT_PER_VISIT);
eq('null falls back', parsePerVisit(null), DEFAULT_PER_VISIT);
eq('a negative falls back', parsePerVisit('-5'), DEFAULT_PER_VISIT);
eq('a decimal falls back', parsePerVisit('2.5'), DEFAULT_PER_VISIT);
eq('absurd falls back', parsePerVisit('99999'), DEFAULT_PER_VISIT);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
