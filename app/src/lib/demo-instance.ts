/**
 * The PUBLIC DEMO deployment.
 *
 * A second Worker, on its own subdomain, with its own database holding nothing
 * but invented people. It exists so a pastor can click through the real thing
 * before speaking to anybody, and so the app can be screenshotted by someone
 * who does not have — and should not have — an account on the real one.
 *
 * Distinct from `lib/demo.ts`, which is the ?demo=1 display transform on the
 * REAL app for taking screenshots. This is a whole separate instance.
 *
 * Two behaviours, both switched by one var:
 *   1. no sign-in — everyone is the same synthetic staff user
 *   2. TEXTING IS IMPOSSIBLE — checked where the send happens, not in the UI
 *
 * The second is the one that matters. A hidden button is not a disabled one,
 * and a demo that can reach real handsets would be worse than no demo.
 */
import type { SessionUser } from './session.ts';
import { ROLES, type Role } from './permissions.ts';

export function isDemoInstance(env: { DEMO_INSTANCE?: string } | undefined): boolean {
  return env?.DEMO_INSTANCE === '1';
}

/** Everybody on the demo is this person. Admin, so every screen is reachable. */
export const DEMO_USER: SessionUser = {
  id: 0,
  email: 'demo@example.org',
  name: 'Demo',
  role: 'admin',
  // The demo shows the compose screen. It can never send: sendOne refuses on
  // its first line, and the send route refuses before that.
  kidsCanText: true,
};

/**
 * The demo user, optionally wearing a different role.
 *
 * This exists for ONE reason: the Fairhaven Kids permission gate cannot otherwise be
 * verified before it is deployed. The definition of done for that feature is
 * "sign in as a volunteer and confirm /people, /messaging and /staff are
 * refused" — but signing in needs Google, and the local bypass makes everyone
 * an admin, who is refused nothing. So the check that matters most was the one
 * check impossible to perform.
 *
 * Set DEMO_ROLE=kids in .dev.vars alongside DEMO_INSTANCE=1 and the whole app
 * behaves as it would for a volunteer.
 *
 * It adds no risk that DEMO_INSTANCE does not already carry: this is only ever
 * consulted when DEMO_INSTANCE is '1', which disables sign-in altogether and is
 * never set on the real app. An unrecognised value falls back to admin — the
 * demo must keep working as a demo, and a typo in a var should not quietly
 * hide half the public demo's screens.
 */
export function demoUser(env: { DEMO_ROLE?: string } | undefined): SessionUser {
  const wanted = env?.DEMO_ROLE;
  const role = ROLES.find((r) => r.id === wanted)?.id;
  return role ? { ...DEMO_USER, role: role as Role } : DEMO_USER;
}

/** Why a send was refused, for showing to whoever pressed the button. */
export const DEMO_SEND_REFUSED =
  'This is the demo — no text is ever actually sent. Everything else works exactly as it does in the real app.';

/**
 * The member whose listing the demo's "edit my details" page belongs to.
 *
 * /directory/me is scoped to a member session's personId — never to anything in
 * a form — so on the demo there is no session and the page bounced. Pointing it
 * at one fixed invented person lets a visitor see what a MEMBER sees, which is
 * half of what makes the directory worth showing: not just that it exists, but
 * that people maintain their own entry.
 *
 * Person 1 is the first adult the seed creates, so they always exist and always
 * have a full record.
 */
export const DEMO_MEMBER_PERSON_ID = 1;
