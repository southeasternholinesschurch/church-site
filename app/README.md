# Staff app — people, attendance, bulletin, directory

Private. Nothing here is reachable from example.org, and no member
data ever reaches the public static build. Phases 3–5 of the build brief.

## Why this is separate from `site/`

The public site is static files — that is why it is free and why it cannot
break. This app has to run code on every request and remember things between
them, which is a different kind of thing entirely. Keeping them apart means a
bug in here cannot take the church's website down.

## Stack, and why

| | |
|---|---|
| **Cloudflare Workers + D1** | Free at this scale, on the account that already runs the site — one deploy pipeline and one bill (zero) rather than two. The brief named Render + Postgres; Render's free tier deletes databases after 30 days and sleeps web services, so it would have been ~$14/month forever for a volunteer-run church. D1 is SQLite; at a few thousand rows the difference is invisible, and it is a single file so it stays portable. |
| **D1 Time Travel** | Satisfies the brief's "nightly backup" with 30 days of point-in-time restore, built in — better than a cron job that can silently stop working. |
| **Astro SSR** | Same framework as the public site, so there is one thing for a future volunteer to learn, and the design tokens carry across. |
| **Drizzle** | Typed schema in one file, and migrations that are plain SQL applied by wrangler — local and production move through identical files. |
| **Google sign-in** | No passwords to reset and no email to send. That last part matters: the domain now publishes SPF `-all` and DMARC `p=reject`, so emailed login links would need that reopened. |

**Authentication is not authorisation.** Google will happily authenticate anyone
on earth. Signing in proves who someone *is*; the `staff` table decides whether
they are allowed in. Nobody self-registers, and the check is re-run on every
request — so revoking access takes effect immediately rather than whenever a
session happens to expire.

## Setting it up

```bash
npm install
npx wrangler d1 migrations apply changeme-app --local
node scripts/staff.mjs add you@gmail.com --admin
npm run dev            # http://localhost:4322
```

Sign-in needs a Google OAuth client (same Google Cloud project as the YouTube
key). Authorised redirect URIs:

- `http://localhost:4322/auth/callback` — development
- `https://<the app's domain>/auth/callback` — production

Then create `app/.dev.vars` (gitignored, never committed):

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

In production these are Worker secrets, not variables. Note the Cloudflare trap
learned the hard way on the public site: **a secret added in the dashboard does
nothing until a build promotes it** — push a commit after adding one.

## Managing access

```bash
node scripts/staff.mjs list
node scripts/staff.mjs add someone@gmail.com --admin --remote
node scripts/staff.mjs revoke someone@gmail.com --remote
```

`revoke` deactivates rather than deletes, and drops their live sessions, so the
record of who once had access survives.

## Member data never enters this repository

The Breeze export contains real names, phones and addresses for ~120 people. It
is read from a local file and written straight to the database; it is never
committed, and there is no seed file containing real people. Anything checked in
for development is synthetic.

## The adult/child field has three states, not two

`adult` / `child` / `unknown`, and `unknown` is the default. This is not
indecision — 40 of the 120 exported rows carry no age, no birthday and no family
role, so there is nothing to derive it from. A boolean would force a guess:
defaulting them to adult risks listing a child in the member directory, which is
the single failure the directory's whole design exists to prevent. `unknown` is
treated as "not an adult" everywhere — kept out of the directory, counted as a
child in attendance — and surfaced in the dashboard so it gets resolved rather
than silently assumed.

## Attendance

Check-in is built for a volunteer standing in a doorway with one hand free:
56px tap targets, a search box that filters instantly, and a sticky tally so
the number can be read out without hunting for it. Ticks are optimistic — they
flip immediately and revert only if the save fails, because tapping down a row
of forty should never wait on a round trip.

The check-in screen can also add a person and remove one. **Remove archives; it
never deletes.** Attendance rows reference people, so a hard delete would
cascade and silently change historical totals — last year's number would move.
Archiving takes someone off the roll and out of the directory, and is
reversible. A tablet in a busy doorway is exactly where a mis-tap happens.

Someone added at the door is NOT put in the directory. Consent is gathered in
person by the pastor and is never implied by a name being typed in.

'unknown' counts as a child in the tally, matching how the directory treats it
— one rule rather than two that can drift apart.

## Trends

Inline SVG, no charting library to rot. Attendance over time per service kind,
plus the brief's "regulars who have gone missing": present at 3+ of the
previous 8 services and absent from the last 4. Loose on purpose — a fortnight's
holiday does not appear, someone who quietly stopped in March does.

There is no imported history. The old attendance spreadsheets in Downloads turn
out to be eight variants of an empty template: six contain no marks at all, and
the other two share the same 219 marks across 19,750 cells — an abandoned trial
from April 2025. Trends start from the first real check-in.

## Status

Built: schema and migrations, Google sign-in, sessions, the auth gate, people
list and editor, staff management, the Breeze import, attendance check-in, and
the trends dashboard.

Not yet: photo uploads, the bulletin editor (Phase 4) and the member directory
(Phase 5).

## Deployed

**https://app.example.org** — Cloudflare Worker `changeme-app`, D1
database `changeme-app`. Deployed with `npx wrangler deploy` from this directory.
Not yet connected to Workers Builds, so a `git push` does NOT redeploy it (the
public site does work that way — do not assume the same here).

### Two traps this deployment hit

**The server bundle was almost published.** The Astro Cloudflare adapter writes
`_worker.js/` — the compiled server, auth logic and all — into the same `dist/`
that wrangler uploads as PUBLIC static assets. Wrangler refused the deploy
rather than doing it quietly, which is the only reason it was caught.
`scripts/postbuild.mjs` now writes `.assetsignore` on every build and verifies
its own output, because `dist/` is wiped each time and a hand-made file would
survive exactly once. Confirmed in production: `/_worker.js/index.js` → 404.

**Changing `database_id` orphans the local database.** Wrangler keys local D1
state by the id in wrangler.jsonc, so filling in the real id after
`d1 create` silently pointed local development at a brand-new empty database
while the real one sat on disk under the old hash. Nothing is lost — the file
is in `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/` — but "no such table"
after editing that config means this, not data loss.
