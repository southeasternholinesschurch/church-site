/**
 * Whether a START creates a new person.
 *
 * Small function, large consequence. Bus-ministry guardians are deliberately
 * NOT `people` rows — that is what keeps the congregation's people list, the
 * messaging audience counts and the attendance statistics free of non-members.
 * The webhook has always created a `people` row for a START from a number it
 * did not recognise, which is right for a stranger and wrong for a bus parent:
 * it would dissolve that separation one text at a time, invisibly, and the
 * only symptom would be counts that slowly stopped meaning anything.
 *
 * The database halves of lib/consent.ts (applyOptOut / applyOptIn) are not
 * unit-tested here — they are two UPDATEs with no branching, and the thing
 * worth proving about them is that STOP really does reach a guardian-only
 * number end to end, which is a live test against a real database and is
 * listed in the brief's release criteria.
 *
 * Same plain style and no node: imports as the other tests here.
 *
 *   npm test
 */
import { shouldCreatePersonOnStart } from '../src/lib/consent.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

// A stranger texts START from a number nobody has. Create them, or the opt-in
// goes nowhere and they never appear anywhere staff can see.
eq('unknown number creates a person',
   shouldCreatePersonOnStart({ people: 0, guardians: 0 }), true);

// Already a member. Their consent is recorded on the row that exists.
eq('a known member does not',
   shouldCreatePersonOnStart({ people: 1, guardians: 0 }), false);

// THE ONE THAT MATTERS. A bus-ministry parent is already known — as a
// guardian. Creating a person row here is how the congregation's people list
// quietly fills up with non-members.
eq('a bus-ministry guardian does NOT create a person',
   shouldCreatePersonOnStart({ people: 0, guardians: 1 }), false);

// A parent of three children has three guardian rows. Still not a person.
eq('several guardian rows on one handset still do not',
   shouldCreatePersonOnStart({ people: 0, guardians: 3 }), false);

// A guardian who IS a member exists in both tables. Nothing to create.
eq('a guardian who is also a member does not',
   shouldCreatePersonOnStart({ people: 1, guardians: 2 }), false);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
