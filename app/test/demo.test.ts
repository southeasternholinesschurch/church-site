/**
 * Demo mode — invented people over a real layout.
 *
 * The risk here is one-directional and serious: if any real value survives the
 * transform, it ends up in a screenshot on a public web page. So these tests
 * are mostly assertions that nothing real is left, rather than that the fakes
 * are pretty.
 *
 *   npm test
 */
import { demoPerson, demoName, demoBody, demoOn } from '../src/lib/demo.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/*
 * INVENTED, and it has to stay that way.
 *
 * This fixture used to hold a real member's name, mobile, email and street
 * address — the variable was even called `real` — so that the scrubber could be
 * tested against genuine input. That reasoning is understandable and the
 * consequence is not: it committed one family's full contact record to git, in
 * this repo and in the shared template, where removing it from HEAD does not
 * remove it from history.
 *
 * The scrubber cannot tell the difference. Invented input tests it exactly as
 * well. Numbers here are 555, which is never a live handset.
 */
const real = { id: 22, firstName: 'Marguerite', lastName: 'Ashdown', phone: '(317) 555-8379',
  phoneE164: '+13175558379', email: 'marguerite@example.invalid', addressStreet: '1780 Harrowgate Lane',
  addressCity: 'Fairhaven', addressState: 'IN', addressZip: '46140' };
const spouse = { ...real, id: 32, firstName: 'Wendell' };
const gaps = { id: 99, firstName: 'Cassius', lastName: 'Pettigrew', phone: '(317) 555-1596',
  phoneE164: '+13175551596', email: null, addressStreet: null, addressCity: null,
  addressState: null, addressZip: null };

const a = demoPerson(real, real.id, true);
const b = demoPerson(spouse, spouse.id, true);
const c = demoPerson(gaps, gaps.id, true);

// ---- nothing real survives -------------------------------------------------
const SOURCE_NAMES = ['Marguerite', 'Ashdown', 'Wendell', 'Cassius', 'Pettigrew'];
eq('no source name survives',
   [a, b, c].some((x) => SOURCE_NAMES.includes(x.firstName!) || SOURCE_NAMES.includes(x.lastName!)), false);
eq('no source number survives',
   [a, b, c].some((x) => /5558379|5551596/.test(x.phoneE164 ?? '')), false);
eq('no source street survives',
   [a, b, c].some((x) => /Harrowgate/.test(x.addressStreet ?? '')), false);
eq('no source email survives', /marguerite/.test(a.email ?? ''), false);
// 555-01xx is the range reserved for fiction — it can never be a real handset.
eq('fake numbers are in the fiction range',
   [a, b, c].every((x) => /^\+1317555\d{4}$/.test(x.phoneE164 ?? '')), true);
eq('and the display form matches it',
   [a, b, c].every((x) => /^\(317\) 555-0\d{3}$/.test(x.phone ?? '')), true);

// ---- it has to look plausible ---------------------------------------------
// A household with two different streets reads as a bug in a screenshot.
eq('a household keeps one address', a.addressStreet === b.addressStreet && a.addressZip === b.addressZip, true);
eq('but the two people differ', a.firstName === b.firstName, false);
// The People list exists to show which records are incomplete; demo mode must
// not quietly fill those gaps in or the screenshots misrepresent the data.
eq('an empty field stays empty', [c.email, c.addressStreet, c.addressCity], [null, null, null]);

// ---- stable, so pages agree with each other --------------------------------
eq('same person, same fake, every call', demoPerson(real, real.id, true).firstName, a.firstName);
eq('demoName agrees with demoPerson', demoName(real.id, true, 'x', real.addressStreet), `${a.firstName} ${a.lastName}`);

// ---- off is genuinely off --------------------------------------------------
eq('off changes nothing', demoPerson(real, real.id, false), real);
eq('off leaves a name alone', demoName(real.id, false, 'Marguerite Ashdown'), 'Marguerite Ashdown');
eq('off leaves a message alone', demoBody(1, false, 'private'), 'private');

// ---- inbound texts are replaced outright -----------------------------------
// They can contain anything — a prayer request, a family matter.
eq('an inbound body is replaced', demoBody(1, true, 'my private message') === 'my private message', false);

// ---- the gate --------------------------------------------------------------
// Both conditions required. A member following a directory link must never be
// able to reach demo mode by adding the flag.
eq('staff + flag turns it on', demoOn(new URL('https://x/?demo=1'), { id: 1 }), true);
eq('flag alone does NOT', demoOn(new URL('https://x/?demo=1'), null), false);
eq('staff alone does NOT', demoOn(new URL('https://x/'), { id: 1 }), false);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
