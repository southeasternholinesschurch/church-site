/**
 * Who may reach which URL.
 *
 * The feature IS this file. Fairhaven Kids exists so ten volunteers can take a register
 * without also holding the congregation's addresses and phone numbers;
 * everything else in it is pages, and this is the part that either works or
 * quietly does not. A leak here is silent — nobody complains about access they
 * were not supposed to have.
 *
 * Same plain style and no node: imports as the other tests here, for the same
 * reason — this is a Workers project and node types are not in scope.
 *
 *   npm test
 */
import { canAccess, homeFor, isKidsRole, canIssueCards, canLinkChurchRecords,
  kidsSendScope, mayTextRoute, ROLES }
  from '../src/lib/permissions.ts';
import type { Role } from '../src/lib/permissions.ts';

let fail = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.error(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}`);
};
const allows = (role: Role, path: string) =>
  eq(`${role} may reach ${path}`, canAccess(role, path), true);
const refuses = (role: Role, path: string) =>
  eq(`${role} is refused ${path}`, canAccess(role, path), false);

// ---- a volunteer reaches the children's section and nothing else -----------
for (const p of ['/kids', '/kids/', '/kids/child/12', '/kids/register/3']) allows('kids', p);
for (const p of [
  '/', '/people', '/people/12', '/attendance', '/attendance/trends',
  '/messaging', '/messaging/inbox', '/groups', '/bulletin', '/website',
  '/staff', '/invites',
]) refuses('kids', p);

// ---- and cannot POST straight to an API either -----------------------------
// Hiding a link is not access control. These are the routes that would hand
// over the whole congregation or spend the church's money.
for (const p of [
  '/api/people/export', '/api/sms/send', '/api/sms/check-numbers',
  '/api/checkin', '/api/site/publish',
]) refuses('kids', p);

// ---- a route nobody has thought of yet is denied by default ----------------
// The point of the allowlist: this must not need editing when /finance or
// /api/giving is added next year. That is the whole reason it is not a
// blocklist.
refuses('kids', '/finance');
refuses('kids-director', '/api/giving/export');
allows('editor', '/finance');

// ---- a prefix match cannot be widened by a lookalike path ------------------
// The classic prefix-allowlist leak: a plain startsWith('/kids') grants these.
refuses('kids', '/kidsplayground');
refuses('kids', '/kids-admin');
refuses('kids', '/kidsecret/people');

// ---- an encoded traversal does not smuggle a volunteer out of /kids --------
// The router resolves these to something outside /kids, while a naive prefix
// test sees a string that begins "/kids/".
refuses('kids', '/kids/%2e%2e/people');
refuses('kids', '/kids/../people');
refuses('kids', '//people');

// ---- director-only pages --------------------------------------------------
// Class structure and the Fairhaven Bucks credit amount. Deliberately short: the
// director/teacher line is about what you can RESTRUCTURE, not what you can see
// or record.
for (const p of ['/kids/classes', '/kids/settings', '/kids/kiosk', '/kids/cards']) {
  refuses('kids', p);
  allows('kids-director', p);
}

// ---- a teacher or bus worker can add and edit children --------------------
// the pastor, 2026-09-08. A bus worker meets a child on the route on a Sunday
// morning; if adding them needs a director, the child goes unrecorded.
allows('kids', '/kids/child/41');
allows('kids', '/kids/child/41/notes');
allows('kids', '/kids/child/new');

// ---- the existing two roles are unchanged ---------------------------------
allows('admin', '/staff');
refuses('editor', '/staff');
refuses('editor', '/staff/anything');
// Publishing to the public website is admin-only — the pastor's call. The launcher
// goes with it, since it carries links into the Cloudflare and Twilio consoles.
refuses('editor', '/website');
refuses('editor', '/website/right-now');
// The endpoints, not just the pages. An editor who cannot open the photos
// screen must not be able to POST to the route behind it either.
refuses('editor', '/api/site/photo');
refuses('editor', '/api/site/publish');
for (const p of ['/', '/people', '/messaging', '/api/sms/send', '/kids']) allows('editor', p);
allows('admin', '/website/right-now');

// ---- the gate is asymmetric, which is the point ---------------------------
// An admin walks DOWN into the children's section; a volunteer never walks up.
allows('admin', '/kids/settings');
allows('editor', '/kids/register/2');
refuses('kids-director', '/');

// ---- a refused person is sent somewhere they can actually use -------------
eq('a volunteer goes to /kids', homeFor('kids'), '/kids');
eq('a director goes to /kids', homeFor('kids-director'), '/kids');
eq('staff go to the dashboard', homeFor('editor'), '/');
eq('an admin goes to the dashboard', homeFor('admin'), '/');

// ---- the kiosk's own paths are outside the staff allowlist ----------------
// /kiosk is neither public nor staff — it has its own principal and its own
// middleware branch, which returns before the gate below is ever consulted.
// These assertions record that no KIDS role can reach it as a person.
refuses('kids', '/kiosk');
refuses('kids-director', '/kiosk');
refuses('kids', '/kiosk/scan');

// ---- issuing cards is director-and-above ----------------------------------
// A card is a credential. Checked as an action rather than a path because
// cards live on the child page, which teachers need for everything else.
eq('a teacher may not issue cards',   canIssueCards('kids'), false);
eq('a director may',                  canIssueCards('kids-director'), true);
eq('staff may',                       canIssueCards('editor'), true);
eq('an admin may',                    canIssueCards('admin'), true);

// ---- who may reach into the church's own records ---------------------------
// Typing a van-route parent's details is intake and anyone does it. Searching
// `people` from inside /kids is different: it reaches the congregation from a
// section built so volunteers cannot.
eq('a teacher may not link a member',  canLinkChurchRecords('kids'), false);
eq('a director may',                   canLinkChurchRecords('kids-director'), true);
eq('staff may',                        canLinkChurchRecords('editor'), true);
eq('an admin may',                     canLinkChurchRecords('admin'), true);

// ---- who may text a bus route ---------------------------------------------
// Sending is a capability, not a role. The scope this returns IS the audience;
// nothing downstream may widen it from a form value.
eq('a director texts any route',        kidsSendScope('kids-director', false, []), 'all');
eq('an admin too',                      kidsSendScope('admin', false, []), 'all');
eq('staff too',                         kidsSendScope('editor', false, []), 'all');
// The common case: a volunteer who has never been given the flag.
eq('a volunteer cannot send',           kidsSendScope('kids', false, []), null);
eq('nor with routes but no flag',       kidsSendScope('kids', false, [1, 2]), null);
// A captain reaches their own routes and no others.
eq('a captain gets their routes',       kidsSendScope('kids', true, [2]), [2]);
eq('several routes',                    kidsSendScope('kids', true, [1, 3]), [1, 3]);
// THE ONE THAT MATTERS. A flag with no assignment must be nobody, never
// everybody — getting this backwards texts every family in the ministry.
eq('the flag alone reaches NOBODY',     kidsSendScope('kids', true, []), []);

// ---- and the per-route check every send makes -----------------------------
eq('a director may text route 7',       mayTextRoute('all', 7), true);
eq('a captain may text their own',      mayTextRoute([2], 2), true);
// Submitting a route id they were not assigned reaches nobody new.
eq('but not another route',             mayTextRoute([2], 3), false);
eq('nor one that does not exist',       mayTextRoute([2], 999), false);
eq('no scope, no route',                mayTextRoute(null, 2), false);
eq('an empty scope reaches no route',   mayTextRoute([], 2), false);

// ---- every role in the picker is a role the gate understands --------------
// A role offered on /staff that canAccess has never heard of would fall past
// every branch and land on the admin one — granting everything to somebody
// added as a volunteer.
for (const r of ROLES) allows(r.id, '/kids');
eq('the kids roles are exactly the two',
   ROLES.filter((r) => isKidsRole(r.id)).map((r) => r.id), ['kids', 'kids-director']);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
if (fail) process.exit(1);
