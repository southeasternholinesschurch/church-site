/**
 * ONE definition of how a service is counted, used by both the check-in page's
 * first render and the API that updates it live.
 *
 * There were two, and they drifted: the API counted unknown visitors toward
 * the total and the page did not, so adding a visitor bumped the number and a
 * reload silently took it away again. Anything that counts a service counts it
 * through here.
 */
export interface Countable { adultChild: 'adult' | 'child' | 'unknown' }

export interface Tally {
  adults: number; children: number; unsplit: number;
  total: number; visitors: number;
}

export function tally(present: Countable[], visitors: Countable[]): Tally {
  // A PERSON of unknown status counts as a child — they are on the roll,
  // someone can resolve it, and erring toward child is the safe side of the
  // directory rule. A VISITOR of unknown status is genuinely unknown: nobody
  // was asked and nobody will go back and find out, so they are counted in the
  // total but kept out of the split rather than guessed into it.
  const adults = present.filter((p) => p.adultChild === 'adult').length
    + visitors.filter((v) => v.adultChild === 'adult').length;
  const children = present.filter((p) => p.adultChild !== 'adult').length
    + visitors.filter((v) => v.adultChild === 'child').length;
  const unsplit = visitors.filter((v) => v.adultChild === 'unknown').length;

  return { adults, children, unsplit, total: adults + children + unsplit, visitors: visitors.length };
}
