/**
 * Who may reach which URL.
 *
 * This is the app's FIRST real permission structure. Until now every route
 * treated "signed in" as "fully trusted", and the single role check lived on
 * /staff. So the risk here is not that the logic below is subtly wrong — it is
 * that somebody adds a route and forgets this file exists. One pure function,
 * called from one place (the middleware), is the shape that survives that.
 *
 * ALLOWLIST, NEVER A BLOCKLIST. A path this file has never heard of is denied
 * to a volunteer. Getting it wrong should cost a volunteer access to something
 * they will complain about, not silently hand them the congregation's
 * addresses and phone numbers.
 *
 * The gate is deliberately ASYMMETRIC, which is the pastor's call: an admin walks
 * down into the children's section, a volunteer never walks up out of it.
 */

export type Role = 'admin' | 'editor' | 'kids-director' | 'kids';

/** For the picker on /staff and the `staff.mjs` script. Order is least to most. */
export const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: 'kids', label: 'Fairhaven Kids volunteer',
    blurb: 'The children’s section only. Takes attendance, edits a child’s details.' },
  { id: 'kids-director', label: 'Fairhaven Kids director',
    blurb: 'The children’s section, plus classes, adding children, and settings.' },
  { id: 'editor', label: 'Staff',
    blurb: 'The whole dashboard except who can sign in.' },
  { id: 'admin', label: 'Admin',
    blurb: 'Everything, including granting access.' },
];

/** The children's section. Everything a volunteer may ever touch is under here. */
export const KIDS_ROOT = '/kids';

/**
 * Inside /kids, the pages only a director may open.
 *
 * Path-separated rather than checked inside each page, so the rule is testable
 * and greppable.
 *
 * Teachers and bus workers may both EDIT and CREATE children (the pastor,
 * 2026-09-08) — which is why neither /kids/child/[id] nor /kids/child/new
 * appears here. A bus worker meets a child on the route and needs to add them
 * on the spot; making them find a director first means the child is not
 * recorded at all. The existing check-in screen made the same call for the
 * same reason.
 *
 * DELETING a child is still not here because it is not a page: children are
 * archived, never deleted (see people.archived), and archiving is a
 * director-only action enforced where it happens.
 */
const KIDS_DIRECTOR_ONLY = [
  '/kids/classes',
  '/kids/settings',
  // Registering a check-in tablet, and pairing one. §4 lists it with the other
  // structural acts a teacher may not do.
  '/kids/kiosk',
  // Writing the cards themselves. Same reasoning as issuing one: a card is a
  // credential, and this page hands out seventy of them in a sitting.
  '/kids/cards',
];

/** Granting access is the one thing an editor has never been able to do. */
const ADMIN_ONLY = ['/staff'];

export const isKidsRole = (role: Role): boolean =>
  role === 'kids' || role === 'kids-director';

/**
 * May this person issue and revoke children's cards?
 *
 * Director and above. §4 puts cards on the short list of things a teacher may
 * not do, alongside restructuring classes and changing the credit amount —
 * because a card is a CREDENTIAL, and handing out or killing credentials is a
 * different kind of act from taking a register.
 *
 * Checked as an ACTION rather than by path, unlike everything else in this
 * file, because cards live on the child's page and teachers need that page for
 * everything else on it. The decision still lives here rather than inline in
 * the page, so there is one file to read to know what a teacher cannot do, and
 * one file to test.
 */
export const canIssueCards = (role: Role): boolean => role !== 'kids';

/**
 * May this person link a child to somebody in the CHURCH'S OWN records?
 *
 * Director and above. Typing a van-route parent's details is intake — any
 * volunteer does it. Reaching into `people` to find a member is a different
 * act: it searches the congregation from inside a section whose whole purpose
 * is that volunteers cannot reach the congregation. A teacher who needs a link
 * made asks; it is a setup task, done once per family.
 *
 * The same predicate as canIssueCards today, and deliberately its own function:
 * they are different questions that happen to share an answer, and one may
 * change without the other.
 */
export const canLinkChurchRecords = (role: Role): boolean => role !== 'kids';

/**
 * WHICH BUS ROUTES THIS PERSON MAY TEXT.
 *
 * 'all'  — every route, and every Fairhaven Kids family
 * number[] — only these routes, and nobody else
 * null   — may not send at all
 *
 * Sending is a capability rather than a role (§7.1): the director texts anyone,
 * some bus captains text their own route, and most volunteers never send. Two
 * extra roles would have doubled the matrix to express one boolean.
 *
 * The RETURNED SCOPE IS THE AUDIENCE. Nothing downstream may widen it from a
 * form value — a captain submitting a route id they were not assigned must
 * reach nobody new, which is a stated release requirement and the reason routes
 * are rows rather than free text. Pure, so that requirement is testable without
 * a database or a browser.
 */
export type SendScope = 'all' | number[];

export function kidsSendScope(
  role: Role, kidsCanText: boolean, assignedRouteIds: number[],
): SendScope | null {
  // A director may text any route. Staff and admins already have the whole
  // messaging screen, so withholding the children's one would be theatre.
  if (role !== 'kids') return 'all';
  // A volunteer without the flag cannot send. This is the common case.
  if (!kidsCanText) return null;
  /*
   * A captain with the flag but no routes assigned reaches NOBODY — an empty
   * list, not 'all'. Getting this backwards is how a permissions bug turns into
   * a text to every family in the ministry, so it is stated rather than left to
   * fall out of a loop.
   */
  return [...assignedRouteIds];
}

/** May this scope reach this particular route? The check every send makes. */
export function mayTextRoute(scope: SendScope | null, routeId: number): boolean {
  if (scope === null) return false;
  if (scope === 'all') return true;
  return scope.includes(routeId);
}

/** Where this person belongs when they land on something they may not have. */
export const homeFor = (role: Role): string =>
  isKidsRole(role) ? KIDS_ROOT : '/';

/**
 * `/kids` matches `/kids` and `/kids/anything`, but NOT `/kidsplayground`.
 * A plain startsWith would grant the third, which is how prefix allowlists
 * usually leak.
 */
const under = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

/**
 * Anything that could still change meaning after this function has looked at
 * it. `context.url.pathname` is already resolved, so `/kids/../people` never
 * arrives here as such — but a PERCENT-ENCODED traversal does, and would sail
 * through `under()` as "/kids/..." while the router reads it as /people.
 *
 * Volunteers get no benefit of the doubt; a path carrying either is refused.
 */
const suspicious = (path: string): boolean =>
  path.includes('..') || path.includes('%') || path.includes('//');

/**
 * The whole decision. Called by the middleware for every non-public request.
 *
 * Returns only allow/deny on purpose: whether a refusal should be a redirect
 * (a person on a page) or a 403 (a fetch to an API) is the caller's business,
 * and mixing the two in here would make the rule harder to test than to state.
 */
export function canAccess(role: Role, pathname: string): boolean {
  const path = pathname.length > 1 && pathname.endsWith('/')
    ? pathname.slice(0, -1)
    : pathname;

  if (isKidsRole(role)) {
    if (suspicious(path)) return false;
    // The allowlist, in full: one prefix.
    if (!under(path, KIDS_ROOT)) return false;
    if (role === 'kids' && KIDS_DIRECTOR_ONLY.some((p) => under(path, p))) return false;
    return true;
  }

  if (role === 'editor') return !ADMIN_ONLY.some((p) => under(path, p));

  return true;
}
