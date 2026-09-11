/**
 * Fairhaven Kids logic that does not touch the database.
 *
 * Kept separate so it can be unit-tested in plain node — see test/kids.test.ts
 * and the note in lib/consent.ts about why these files import no db module.
 */

export interface AgeClass { id: number; name: string; minAge: number | null; maxAge: number | null }

/**
 * How old someone born on `birthday` is on `today`. Both are 'YYYY-MM-DD' in
 * the church's own timezone; neither is an instant.
 *
 * Parsed by SPLITTING THE STRING, not with `new Date(iso)`. `new Date('2019-07-04')`
 * is parsed as UTC midnight, which is the previous evening in Fairhaven —
 * the bug that shipped on the public site once already and renders a day early.
 * Nothing here needs a Date at all: an age is arithmetic on three integers.
 */
export function ageOn(birthday: string | null, today: string): number | null {
  const b = parseYmd(birthday);
  const t = parseYmd(today);
  if (!b || !t) return null;
  let age = t.y - b.y;
  // Not had this year's birthday yet.
  if (t.m < b.m || (t.m === b.m && t.d < b.d)) age--;
  // A birthday in the future, or a typo'd year, is not an age.
  return age < 0 || age > 130 ? null : age;
}

function parseYmd(s: string | null): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

/**
 * Which class this age falls in — a SUGGESTION only.
 *
 * A child's class is stored explicitly on their profile and never derived.
 * `people.birthday` is sparse (13 of 120 in the Breeze import had one) and
 * bus-ministry children mostly have none, so deriving would file every one of
 * them nowhere, silently. This exists so a profile can say "should probably be
 * in Ages 7-9" and a person can agree or not — which is also what makes the
 * yearly move-up something the director can see rather than remember.
 */
export function suggestClass(age: number | null, classes: AgeClass[]): AgeClass | null {
  if (age === null) return null;
  return classes.find((c) =>
    c.minAge !== null && c.maxAge !== null && age >= c.minAge && age <= c.maxAge) ?? null;
}

/** Whether a child is in the class their age suggests. Null when there is
 *  nothing to compare — no birthday, or no class yet. */
export function classMismatch(
  age: number | null, currentClassId: number | null, classes: AgeClass[],
): boolean | null {
  if (age === null || currentClassId === null) return null;
  const s = suggestClass(age, classes);
  if (!s) return null;
  return s.id !== currentClassId;
}
