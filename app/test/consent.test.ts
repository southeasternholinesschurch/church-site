/**
 * Texting consent, across every table that holds a phone number.
 *
 * TWO THINGS ARE PROVED HERE, and the second one is new.
 *
 * The first is whether a START creates a new person. Small function, large
 * consequence: bus-ministry guardians are deliberately NOT `people` rows, which
 * is what keeps the congregation's people list, the messaging audience counts
 * and the attendance statistics free of non-members. The webhook has always
 * created a `people` row for a START from a number it did not recognise, which
 * is right for a stranger and wrong for a bus parent — it would dissolve that
 * separation one text at a time, invisibly, and the only symptom would be
 * counts that slowly stopped meaning anything.
 *
 * The second is THAT A STOP REACHES EVERY TABLE. This file used to say the
 * database halves were not worth unit-testing, because they were two UPDATEs
 * with no branching. They are now three, and the third carries a field the
 * others do not: a sign-up's `remind` flag, which is what the reminder
 * expansion actually reads. An opt-out that records consent correctly and
 * leaves that flag set is an opt-out that looks handled in the log and sends a
 * text the next morning anyway — the exact failure the guardian half of this
 * file was written after. So the writes are driven through a recording stand-in
 * for the database, which needs no D1 and no running Worker.
 *
 * Same plain style and no node: imports as the other tests here.
 *
 *   npm test
 */
import { shouldCreatePersonOnStart, applyOptOut, applyOptIn } from '../src/lib/consent.ts';
import * as schema from '../src/db/schema.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};

/* ==== does a START create a person? ====================================== */

// A stranger texts START from a number nobody has. Create them, or the opt-in
// goes nowhere and they never appear anywhere staff can see.
eq('unknown number creates a person',
   shouldCreatePersonOnStart({ people: 0, guardians: 0, signups: 0 }), true);

// Already a member. Their consent is recorded on the row that exists.
eq('a known member does not',
   shouldCreatePersonOnStart({ people: 1, guardians: 0, signups: 0 }), false);

// THE ONE THAT MATTERS. A bus-ministry parent is already known — as a
// guardian. Creating a person row here is how the congregation's people list
// quietly fills up with non-members.
eq('a bus-ministry guardian does NOT create a person',
   shouldCreatePersonOnStart({ people: 0, guardians: 1, signups: 0 }), false);

// A parent of three children has three guardian rows. Still not a person.
eq('several guardian rows on one handset still do not',
   shouldCreatePersonOnStart({ people: 0, guardians: 3, signups: 0 }), false);

// A guardian who IS a member exists in both tables. Nothing to create.
eq('a guardian who is also a member does not',
   shouldCreatePersonOnStart({ people: 1, guardians: 2, signups: 0 }), false);

/*
 * A SIGN-UP SHEET ROW IS NOT A REASON TO WITHHOLD ONE, and this is a decision
 * rather than an oversight. A guardian is a standing record of a human being,
 * with a name, a relationship and children attached. A sign-up is somebody who
 * typed a name into a box once to bring a casserole on Tuesday. Someone who
 * then texts START is still a stranger to the church's records, and dropping
 * their opt-in on the floor is the failure this function exists to prevent.
 */
eq('a number seen only on a sign-up sheet still creates a person',
   shouldCreatePersonOnStart({ people: 0, guardians: 0, signups: 1 }), true);
eq('but a member who also signed up does not',
   shouldCreatePersonOnStart({ people: 1, guardians: 0, signups: 2 }), false);

/* ==== does a STOP reach every table? ===================================== */

/**
 * A stand-in for the database that records what it was asked to write.
 *
 * Drizzle's update builder is chained and then awaited, so this mimics exactly
 * that shape and nothing else. It needs no D1, no bindings and no Worker —
 * which is the only reason this can be a plain node test at all.
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

const NUMBER = '+13175550142';
/** Which table a recorded write went to, by identity — not by name. */
const wrote = (writes: Write[], table: unknown): Write[] =>
  writes.filter((w) => w.table === table);

{
  const { db, writes } = recordingDb();
  await applyOptOut(db as never, NUMBER);

  // ALL THREE. Unconditionally, with no prior lookup: the cost of updating zero
  // rows is nothing, and a branch here is a branch that can be wrong.
  eq('STOP writes to people', wrote(writes, schema.people).length, 1);
  eq('STOP writes to guardians', wrote(writes, schema.kidGuardians).length, 1);
  eq('STOP writes to sign-ups', wrote(writes, schema.signups).length, 1);

  const s = wrote(writes, schema.signups)[0]!.values;
  eq('a sign-up is marked opted out', s.smsConsent, 'opted_out');
  eq('and dated, so the record can be defended', typeof s.smsConsentAt, 'string');

  /*
   * THE ASSERTION THIS WHOLE FILE IS FOR.
   *
   * A STOP from a number that has only ever appeared on a sign-up sheet must
   * turn that sign-up's reminder OFF. `remind` is the field the reminder
   * expansion reads; recording the consent and leaving the flag set would be an
   * opt-out that reads as handled in the log and texts the person anyway at 9am
   * the next morning.
   */
  eq('AND ITS REMINDER IS TURNED OFF', s.remind, false);

  // `signups` has no updated_at — a sign-up is a moment, not a record kept in
  // step. Setting one would throw at the database rather than be ignored.
  eq('no updated_at is written to sign-ups', 'updatedAt' in s, false);
  eq('but people does carry one', 'updatedAt' in wrote(writes, schema.people)[0]!.values, true);

  /*
   * AND WHAT IS ALREADY QUEUED IS CANCELLED.
   *
   * The four table updates stop the app deciding to text this number again.
   * They do nothing about a reminder expanded at 9am when the STOP arrives at
   * 9:02 — which would be a correctly recorded opt-out and a text still waiting
   * to go out. Twilio would probably block it at the carrier level; "probably"
   * is not the standard, and leaning on a third party to enforce our own
   * consent record is the shape of the guardian bug all over again.
   */
  const queued = wrote(writes, schema.scheduledMessages);
  eq('STOP cancels what is already queued', queued.length, 1);
  eq('the cancelled row is marked skipped', queued[0]!.values.status, 'skipped');
  eq('with a reason a human can read', queued[0]!.values.note, 'Opted out before this was sent');
}

{
  const { db, writes } = recordingDb();
  await applyOptIn(db as never, NUMBER);
  // Three tables. START does NOT touch the queue — there is nothing in it for
  // somebody who has just opted in, and resurrecting a skipped message would
  // send a reminder for a day that has long since passed.
  eq('START writes to the three tables and not the queue', writes.length, 3);
  const s = wrote(writes, schema.signups)[0]!.values;
  eq('a sign-up is marked opted in', s.smsConsent, 'opted_in');

  /*
   * AND `remind` IS NOT SWITCHED BACK ON. Deliberately asymmetric with the
   * opt-out above.
   *
   * Consent to be texted is not the same as having asked for a reminder about a
   * particular Tuesday. Somebody texting START has said they are willing to
   * hear from the church; they have not re-volunteered for a reminder they
   * turned off weeks ago, about a meal they may no longer be bringing.
   */
  eq('but a reminder is NOT switched back on', 'remind' in s, false);
}

{
  // An empty number does nothing at all, rather than matching every row whose
  // number is blank — which is most of the bus-ministry table.
  const { db, writes } = recordingDb();
  await applyOptOut(db as never, '');
  eq('an empty number writes nothing', writes.length, 0);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
