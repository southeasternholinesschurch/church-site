> **This is the ORIGINAL church's build log, kept as reference.**
>
> It is the record of how this site was actually built for one church — every
> stack decision with its reasoning, every trap that cost real time, and the
> operational steps that live in a dashboard rather than in the repo. Dates,
> counts and a few names are that church's.
>
> **Start with [`SETUP.md`](../SETUP.md) instead.** This file is what you read
> when SETUP.md says "and here is why", or when something behaves oddly and you
> want to know whether it was known about.

# Fairhaven Community Church — Site & App

This repo holds the church's public website (`/site`) and the staff/member app for
people, attendance, texting, the bulletin and the directory (`/app`). This doc covers
what is actually built and how to run, deploy and test it; `build-brief.md` holds the
original plan.

**Current status: everything in the brief is built and live except the PWA offline
layer, which was dropped — see "What is deliberately NOT built" at the end.** Both
halves are deployed and in real use: the public site at `example.org`
and the app at `app.example.org`.

---

## Current state (2026-09-17)

Both halves are live and in use.

**The public site** — all ten pages on the approved design: Home, About (+ beliefs,
I'm new, staff), Ministries (index + four ministry pages), Sermons (archive + series +
single), Events, Livestream, Contact (+ thank-you), Give, Bulletin, Directory.
Livestream auto-detection is wired and returns `configured: true`. The events calendar
feeds the site live. The sermon archive imports itself nightly from YouTube. Both forms
deliver to the church inbox.

Verified across 33 page/width combinations (1440 / 860 / 390): no horizontal scroll, no
broken images, no missing alt text, no text under 11px, no content bleeding out of its
container, every parallax layer composing. All body text meets WCAG AA. With JavaScript
disabled every page renders complete — the motion system only ever adds motion.

**The app** (`app.example.org`) — Google sign-in for staff, the people
database, attendance and visitor check-in, trends, groups, the bulletin editor with a
publish button, SMS broadcast and replies through Twilio, the Monday singing reminder
on a cron, and the member directory with photo upload and member self-edit. Since
2026-09-04 it also carries **scheduled texts**, **automatic birthday texts** and a
**number checker** — see "Scheduled and automatic texts" below. Since 2026-09-17 it
also carries **sign-up sheets** — see that section below.

**The nav bar is nine tabs and was ten more.** Four screens were folded into the
page that already asked their question, which is worth knowing before hunting for a
URL that has gone: Scheduled and Replies are now part of `/messaging`, Trends is a
fold on `/attendance`, and Groups is a fold on `/people` with a picker beside the
search box. `/messaging/inbox`, `/messaging/numbers` and `/attendance/trends` still
render — they are off the bar, not deleted, and remain perfectly good bookmarks.
`/groups` redirects to `/people?groups=open`. The signed-in name and Sign out moved
off the bar to a tan line at the foot of every page (AppLayout only — the children's
section and the directory keep theirs, for reasons in that commit).

**The directory has real data.** On 2026-09-04 the printed church directory was
imported from a CSV: birthdays went 16 -> 97, anniversaries 3 -> 43, addresses 17 -> 91.
Current figures: 128 active people (82 adults, 46 children), 82 listed in the directory,
55 with directory access, 78 textable on 77 handsets.

**Texting is live.** The Twilio 10DLC campaign was approved 2026-09-01 and the first
message was confirmed delivered the same day. Everything before that failed with error
30034; if you are reading old rows in `message_log`, that is why.

The remaining gaps are *content*, not code: Fairhaven Ladies has no photo and Fairhaven Ladies /
Fairhaven Seniors have no real branding. Both are visible on the page rather than silent, and
neither looks broken to a visitor.

For any NEW page, follow [`MIGRATING-PAGES.md`](MIGRATING-PAGES.md) — it carries the
procedure, the verification recipe, and a log of every bug this build hit.

---

## Repo layout

```
/site      Astro static site → Cloudflare Workers Builds (static assets + one Worker
           route for /api/live-status). NOT the Astro Cloudflare adapter.
/app       Astro SSR on @astrojs/cloudflare → Cloudflare Workers. D1 (SQLite) for data,
           R2 for member photos. Staff auth via Google OAuth; members via SMS magic link.
/workers   Two small Cloudflare Workers:
             rebuild-cron/  — daily cron that triggers a site rebuild
             sms-cron/      — hourly cron that POSTs /api/sms/run-due in the app
/docs      This file, plus anything else operational
```

---

## Why this stack

| Choice | Why |
|---|---|
| **Astro + TypeScript** | Ships zero JS by default, fast static output, and content collections give every sermon/ministry/settings entry a typed schema (Zod) — a bad date or missing field fails the build loudly instead of quietly breaking the live site. |
| **npm** (not pnpm/yarn) | Most universal option; least friction for a future volunteer who's never touched this repo before. |
| **Cloudflare (Workers Builds, static assets)** | Free static hosting, fast global edge, Deploy Hooks give us the rebuild plumbing below for free. Note: this is Cloudflare's newer git-connected "Workers Builds" product, not classic "Pages" — same idea, some different UI/mechanics, see "Deploying" below and `site/wrangler.jsonc`'s comments for what that changes. |
| **The staff app edits the site** | Site content is markdown in this repository and the dashboard commits to it through the GitHub API, so a save publishes itself. This replaced Decap CMS, which needed its own OAuth proxy Worker, a GitHub OAuth App, two further secrets and an exception in the content-security policy. One fine-grained token replaces all of it. |
| **Instrument Serif + Texta** | Headings are Instrument Serif (Google Fonts, OFL, free — regular and italic only, no bold, so hierarchy comes from size). Body and UI are Texta, the pastor's own, self-hosted from `site/public/fonts/` so the PWA works offline. **Licensing note:** Texta came from a desktop licence, which typically does NOT cover public web embedding — that's usually a separate tier. Worth confirming with Yellow Design Studio before launch. BD Script was used in an earlier direction and is no longer on the site. Change `--font-body`/`--font-display` in `src/styles/tokens.css` to re-brand. |
| **`node-ical`** | Handles RRULE (recurring events) and EXDATE/overrides for the iCloud calendar feed — see "Testing the events feed" below, this is the brief's flagged risk area. |
| **Web3Forms** for Contact/Prayer forms | A hosted form-relay needs zero DNS changes (no SPF/DKIM records to add) — important since the brief explicitly says don't touch the church's email DNS. Custom mail-sending code would need exactly those DNS changes. |
| **YouTube Data API via a Worker route**, not client-side | Keeps the API key server-side instead of shipping it in browser JS, and gives one shared edge cache instead of every visitor spending quota. Built as `site/worker/index.ts` and wired up via `main` in `wrangler.jsonc` — the site is still a plain static `astro build`; the Worker answers `/api/live-status` and hands everything else to the ASSETS binding. **Not** the Astro Cloudflare adapter, which would break the build. Reads the uploads playlist (2 quota units) rather than `search?eventType=live` (100) — see the Worker's header comment for why that is both cheaper and more accurate. |

---

## Environment variables & secrets

None of these are committed. Set them where noted.

**Cloudflare Worker secrets** (`npx wrangler secret put <NAME>`, run from each worker's folder):
- the app Worker: `GITHUB_TOKEN` — a fine-grained PAT, Contents: read and write, this repository only. This is what lets the dashboard edit the website.
- `workers/rebuild-cron`: `DEPLOY_HOOK_URL` (from the site's Cloudflare project → Settings → Deploy hooks) — **done 2026-08-29**, deployed and verified firing a real rebuild

- the site itself (`site/`): `YOUTUBE_API_KEY` — feeds `/api/live-status`. **Done 2026-08-31.**
  `YOUTUBE_CHANNEL_ID` is optional — the channel is public and hardcoded as a default.
  Without the key the endpoint returns `{ live: false, configured: false }` and the page
  falls back to the countdown, so a missing secret degrades quietly rather than breaking.

  Two traps here, both of which cost time the first time round — read this before rotating
  the key:

  1. **The Worker is named `yourchurch-site-1`**, after the repo — NOT
     `your-church-site`, which is what `site/wrangler.jsonc` says. Workers Builds
     ignores that field and uses the project name, so deploys are unaffected, but anything
     run from the CLI (`npx wrangler secret put …`) targets the name in the config and will
     cheerfully write the secret to the wrong Worker. Use the dashboard, and check the name
     against the `*.workers.dev` hostname.
  2. **Adding a secret in the dashboard does not take effect on its own.** It creates a new
     Worker version, but the version serving traffic is whatever the last build produced —
     so the endpoint keeps reporting `configured: false` with the secret sitting right there.
     Push any commit (an empty one is fine) to trigger a build, which promotes it. Takes
     about two minutes.

**GitHub Actions secrets** (repo → Settings → Secrets and variables → Actions):
- `YOUTUBE_API_KEY` — the same key, for the nightly sermon import — **done 2026-08-31**,
  verified by a manual `workflow_dispatch` run. The importer now *refuses* to run without it
  under `--strict`: durations are what tell a restarted stream's fragments from the real
  recording, and a keyless run would overwrite correct entries with the wrong video.

### The app's secrets

All nine are set with `npx wrangler secret put NAME` from `/app`, and live only on the
Worker — none are in the repo. `npx wrangler secret list` shows what is set.

| Secret | What it is for |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Staff sign-in |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | Sending and validating texts. An API key + secret pair was tried first and was rejected with 20003; the account SID and auth token work. |
| `TWILIO_MESSAGING_SERVICE_SID` | The Messaging Service messages are sent through. The delivery callback belongs on THIS, not on the number. |
| `TWILIO_FROM_NUMBER` | +1 317 218 9622 |
| `REMINDER_SHEET_CSV_URL` | The published singing-schedule CSV that drives the Monday reminder |
| `SMS_CRON_SECRET` | Shared secret the `sms-cron` Worker presents to `/api/sms/run-due`, which is public to the middleware and guarded by this alone |
| `DEPLOY_HOOK_URL` | Fires a site rebuild from the app's "Publish the website now" button. Server-side only — the random ID in the URL *is* the credential. |

The app also binds `DB` (D1, `changeme-app`) and `PHOTOS` (R2, `changeme-photos`) in
`app/wrangler.jsonc`. A binding to a bucket that does not exist fails every deploy, so
if you clone this into a fresh Cloudflare account, create the bucket first.

**In the repo (not secret):** `src/pages/contact.astro` carries the real
`WEB3FORMS_ACCESS_KEY`. It is a submit-only public key, which is why it sits in the
source rather than in a secret. Both forms were verified delivering to
`hello@example.org`.

---

## Setup items — all done, kept as a record

Every item below is complete. They are kept because several carry a finding that is
easy to trip over again (the Web3Forms domain field being informational, why staff
portraits must be cropped square before upload, and so on).

None of these block building/previewing — the site runs fine with placeholders and swaps in
real values as they arrive.

- [x] Church-owned GitHub repo — done 2026-08-29. Pushed via a dedicated SSH deploy key (`~/.ssh/id_ed25519_seh_site` on the pastor's Mac); repo is [your-github-org/your-repo-name](https://github.com/your-github-org/your-repo-name)
- [x] Breeze export received and inspected 2026-08-29 (`docs/breeze-export-notes.md`). the pastor dropped the manual adult/child review at import time. It mattered in the end — adult/child now drives directory visibility, the attendance split AND who appears in the bulletin's birthday list — and it was cleaned up as the directory was built. Two junk records still carry `child` (see Still Outstanding).
- [x] SHC logo — done 2026-08-29. Real files live in `site/src/assets/brand/` (icon mark, dark and white horizontal lockups) and are wired into the nav/footer/favicon/PWA icons via Astro's image pipeline (auto-optimized to WebP). Fairhaven Kids/Fairhaven Youth marks are in too; Fairhaven Ladies/Fairhaven Men/Fairhaven Seniors still have no real logo.
- [x] Fonts — settled. Texta (body/UI, self-hosted from the pastor's own files) + Instrument Serif (display, Google Fonts, OFL). BD Script was used in an earlier direction and has been dropped. Still open: the Texta web-embedding licence — see the note in the stack-choices table above.
- [x] Calendar feed — done 2026-08-29, live and connected (currently empty, waiting on real events)
- [x] **`YOUTUBE_API_KEY`** — fully done. Created on a church-owned Google Cloud project, added BOTH as a GitHub Actions secret (the nightly sermon import runs on it) and as a Cloudflare secret on the site Worker. `/api/live-status` returns `configured: true` and the Livestream page detects a live service; verified against a real test stream. Channel ID: `UC…YOUR_CHANNEL_ID`
- [x] Church inbox email — confirmed 2026-08-30: `hello@example.org`. Shown on the Contact page and the address the forms will deliver to. **Register the Web3Forms key with this address.**
- [x] Real Facebook page URL — done 2026-08-29
- [x] Real Zeffy giving URL — done 2026-08-29 (found via the church's Linktree)
- [x] Web3Forms access key — set and **verified live 2026-08-30**. Both the contact and prayer forms were submitted against the deployed site and delivered to `hello@example.org`. Useful finding: the key was registered with `localhost` as the URL and Web3Forms did **not** enforce it — the registration domain is informational, not an origin restriction.
- [x] "Our neighbors" paragraph on the Give page — written by the pastor 2026-08-30
- [x] Founding year — confirmed 1968, now in the About hero

**Domain cutover: DONE 2026-08-31.** `site` in `site/astro.config.mjs` now names
`https://example.org`. It remains the only place the origin is
configured — the canonical tags, the sitemap and the Contact form's redirect are all
built from it — so if the address ever changes, that is the one line to change.

**Deliberate omission:** the Give page carries no cheque payee and no mailing
address. the pastor's call — who to make a cheque out to is not something the church
publishes. The Linktree (`givingLinksUrl` in site settings) covers the other
digital options instead. Don't reinstate either without asking.
- [x] Staff portrait confirmed with the pastor (2026-08-30)
- [x] Staff portraits — all three in place as of 2026-08-30. Marion's came from a real photo squared up via ChatGPT (confirmed with the pastor; the filename alone doesn't distinguish an AI-generated image from an AI-edited one, and it's worth asking).
- [x] All four staff portraits done. Notes for future ones: Portraits are circle-cropped, so head-and-shoulders works best. `focus` in the CMS moves the crop vertically, but ONLY on a non-square photo — a square source fills the circle exactly and `focus` does nothing. For a tall portrait, crop it square first and keep the uncropped original alongside (see `pastor-full.jpg`), because re-cropping later otherwise means digging the source out of git history. Note `a-wide-congregation-shot.jpg` in the photo library is a wide congregation shot and is deliberately NOT offered as a portrait
- [x] Staff page complete — four entries, real photos, the church's own bios. To add someone: `/admin` → Staff & Leadership (a new photo must be added to `src/lib/staff-assets.ts` first so it appears in the dropdown).
- [x] Kids Club time — Wednesdays at 7:00 (confirmed 2026-08-30)
- Ministry **locations** are deliberately not published for Fairhaven Youth / Fairhaven Ladies / Fairhaven Seniors — the pastor's call. The `where` field is simply omitted on those, so no row renders. Don't add placeholders back.
- [ ] Fairhaven Ladies photo, and real branding (logo + colors) for Fairhaven Ladies and Fairhaven Seniors. **These no longer show any marker on the site** — a ministry without a logo simply shows none, and a card without a photo shows a panel tinted in that ministry's colour. Nothing looks broken to a visitor, so the outstanding work is tracked here rather than advertised on a public page
- [x] Ministry meeting times — all four complete (Fairhaven Kids Sun 4:30 + Kids Club Wed 7:00; Fairhaven Youth Sun 4:30; Fairhaven Ladies monthly; Fairhaven Seniors Sunday school + every other month). Locations deliberately not published.

Search the repo for `TODO(the pastor)` and `REPLACE_WITH` to find every one of these in place.

---

## Running locally

### The public site

```bash
cd site
npm install
npm run dev
```

Draft content (including the two `[SAMPLE]` sermons seeded for design review) is visible in
`npm run dev` but automatically hidden from `npm run build` — see `src/lib/content.ts`. Don't
un-draft the samples; add real sermons instead once ready.

```bash
npm run build      # production build → site/dist
npm run preview    # serve that build locally
npm run check      # typecheck content + Astro files
```

### The staff/member app

```bash
cd app
npm install
npm run dev            # http://localhost:4322
npm run build          # must pass before deploying
npx astro check        # typecheck
npm test               # pure-logic tests (SMS, roster, celebrations)
```

The app talks to a **local copy** of the D1 database in dev, not production. Query
either one directly:

```bash
npx wrangler d1 execute changeme-app --local  --command "SELECT count(*) FROM people;"
npx wrangler d1 execute changeme-app --remote --command "SELECT count(*) FROM people;"
```

Add `--json` when you want to parse the output; the human-readable form is not stable
enough to grep reliably.

**Schema changes** are hand-written SQL in `app/migrations/`, applied to both:

```bash
npm run db:migrate:local
npm run db:migrate:remote
```

`drizzle-kit generate` exists but hangs on interactive rename prompts, so the recent
migrations were written by hand. Match the numbering and keep them additive.

**Signing in locally** is the one awkward part: staff auth is Google OAuth, which does
not work against localhost. To drive a staff page in dev, insert a session row directly
and set the `seh_session` cookie to its id. For a member session, mint a row in
`directory_invites` and open `/directory/join/<token>`. Delete both afterwards.

---

## Deploying

**The site** deploys itself: pushing to `main` triggers Cloudflare Workers Builds.
**The app does not** — run `npm run build && npx wrangler deploy` from `/app`.
The rest of this section is the record of how each piece was set up, 2026-08-29.

1. ✅ **Repo pushed** to the church-owned GitHub account, via a dedicated SSH deploy key.
2. ✅ **Cloudflare project created**: `yourchurch-site-1`, connected to the
   GitHub repo. Root directory `site`, build command `npm run build`, deploy command
   `npx wrangler deploy` (Cloudflare's own default for this project type — see below).
   **Live at https://example.org since 2026-08-31.**

   The `*.workers.dev` hostname now returns 404 and is not coming back: adding
   `routes` to wrangler.jsonc replaces the workers.dev subdomain with the
   custom domains. That is the desired end state — one public origin — but it
   does mean there is no longer a separate URL to check the build on. Verify
   against the real domain.
3. ⚠️ **This landed on Cloudflare's newer "Workers Builds" product, not classic Pages** — when
   you create a project today, Cloudflare's git-integration flow defaults to Workers Builds
   (deploy command `wrangler deploy`), and classic Pages may not even be offered for new
   projects anymore. This mattered here: with no `wrangler.jsonc` present, `wrangler deploy`
   auto-detected an "unconfigured Astro project" and silently ran `astro add cloudflare`,
   converting the static build into a server-rendered Cloudflare Worker — which broke, since
   `node-ical` (uses Node's `fs`) and `sharp` are both build-time-only tools never meant to
   bundle into a Worker. Fixed by committing `site/wrangler.jsonc` with `assets.directory` set
   and no `main` script — that tells Wrangler this is pure static hosting and skips the
   adapter auto-setup entirely. If you ever recreate this project from scratch, that file
   needs to exist *before* the first deploy, or the same auto-conversion will happen again.
4. ✅ **Deploy hook**: site's Cloudflare project → Settings → Deploy hooks → created one.
   Since 2026-09-01 it is also a **button** in the staff app under Website →
   "Publish the website now", so there is nothing to bookmark. Fired server-side
   because the hook URL has no authentication of its own — the random ID in it
   IS the credential, so a link on a page would hand it to every browser that
   loaded the page. Held as the DEPLOY_HOOK_URL secret on the changeme-app Worker.
5. ✅ **rebuild-cron Worker**: deployed (`workers/rebuild-cron`), `DEPLOY_HOOK_URL` secret set
   to the deploy hook from step 4, cron fires daily at 09:00 UTC. Manually verified working:
   `curl https://rebuild-cron.YOUR-SUBDOMAIN.workers.dev` → `ok: deploy hook
   returned 200`.
6. ✅ **Website editing**: built into the staff app at `/website`, admin only.
   Needs one secret on the app Worker — `GITHUB_TOKEN`, a fine-grained PAT with
   Contents: read and write on this repository and nothing else. A save commits,
   and the commit triggers the build, so an edit publishes itself.
   **Check:** `/website` reports a wrong token plainly — length, prefix and
   repository — rather than failing with a bare 401 further in.

Every subsequent push to `main` auto-deploys via Cloudflare's GitHub integration — no extra
steps needed after this one-time setup. Auth for local `wrangler` commands is stored in
`~/Library/Preferences/.wrangler/config/default.toml` on the pastor's Mac (OAuth token, church
Cloudflare account — nothing committed to the repo).

---

## The staff/member app — how it fits together

Deployed with `npm run build && npx wrangler deploy` from `/app`. There is no git
integration on this half: it deploys from the machine you are sitting at, so a change
is not live until someone runs that.

**Two separate kinds of user, deliberately never mixed.**

*Staff* sign in with Google and get the dashboard: people, attendance, trends,
messaging, groups, the bulletin editor. `src/middleware.ts` is deny-by-default — every
route requires a staff session unless its prefix is listed in `PUBLIC_PREFIXES`,
which lives in `src/lib/public-paths.ts` so that the list can be tested without
standing up a request.

*Members* never sign in at all. They receive a personal link by text, tap it once, and
that device is remembered for 90 days. Their sessions live in `member_sessions`, a
**different table** from the staff `sessions`. One table with a role column is how a
member ends up holding a staff session after somebody writes a query that forgets to
check the column; two tables cannot be confused.

### Traps in this half, all of which cost real time

**`/directory` is in `PUBLIC_PREFIXES`, so the middleware returns before setting
`Astro.locals.user`.** Anything under `/directory/*` that needs the staff user must
call `readSession()` itself. This silently broke the directory's "staff can view it
too" fallback for weeks — it was written, it typechecked, and it never once ran.

**`PUBLIC_PREFIXES` is matched with `startsWith`, and two of the entries are two
characters apart.** The sign-up sheets are public at `/signup/{token}`; the staff builder
that creates them is `/signups`. `'/signup/'` does not match `/signups`. `'/signup'`
would, and would hand the whole back end to the internet. The list and the match were
lifted out of the middleware into `lib/public-paths.ts` for exactly this — a list inside
the middleware cannot be tested without standing up a request, and `test/signups.test.ts`
now holds that pair apart. Add a prefix there, not in the middleware, and add the test
with it.

**Never use `new Date('YYYY-MM-DD')` on a birthday or anniversary.** It parses as UTC
midnight, which in Fairhaven is the evening *before*, so every date renders a day
early. Both the directory and `lib/celebrations.ts` parse the string with a regex.
`app/test/celebrations.test.ts` checks all twelve month boundaries.

**Children must never have `includeInDirectory` set.** That flag is guarded at the
write for exactly this reason. The bulletin's birthday list therefore does *not* reuse
the directory's query — see `isCelebrant()` in `lib/celebrations.ts`, which lets adults
in by consent and children in by age.

**Directory invite links are reusable for 30 days, not single-use.** Re-sending an
invite REUSES the person's live link rather than replacing it. It used to delete the
old one, which silently killed the text still sitting in their messages — usually the
one they actually tap. Revocation never depended on that delete: `revokeAccess()` drops
the invites, drops the sessions and marks the person revoked, and `redeemInvite()`
re-checks that status on every open.

**Member photos are never public.** They live in R2 and are served only through
`/directory/photo/[id]`, behind the same check as the directory. Uploads are validated
on their leading bytes, not the browser's `Content-Type`. Replacing a photo mints a new
key so nobody keeps seeing the old face out of cache.

**Cloudflare's zone Browser Cache TTL rewrites `max-age` on the way out**, and its
default is 4 hours. `site/worker/index.ts` deliberately sends `max-age=0, s-maxage=90`
so the EDGE caches the live-status answer and the browser does not — production served
`max-age=14400` instead, so the Livestream page's 60s poll never left the browser and
anyone who opened it in the four hours before a service watched a countdown through the
whole thing. Set to **"Respect Existing Headers"** on 2026-09-04, and the poll also
passes `cache: 'no-store'` so it does not depend on that setting. **A correct
`Cache-Control` in source proves nothing — read the header off production:**

```
curl -sID - https://example.org/api/live-status | grep -i cache-control
```

**`wrangler deploy` REPLACES a Worker's plain vars with whatever the config declares.**
`workers/sms-cron/wrangler.toml` declared none and `APP_URL` lived only in the
dashboard, so deploying a cron change erased it: every tick failed with
`Invalid URL: undefined/api/sms/run-due`, taking the Monday singing reminder with it.
**Secrets are not affected** — they survive a deploy; vars do not, and that asymmetry is
the whole trap. Vars now live in the `.toml`, so the deploy that would erase one is the
deploy that restores it. Check the bindings printed in the deploy output afterwards.

**The public site reads the app's API at BUILD time.** `site/src/pages/bulletin.astro`
fetches `/api/bulletin/current` and bakes the answer in. Adding a field to that endpoint
therefore needs **two deploys in order** — the app first, then the site. Both fired from
one push when the bulletin's singing section shipped, so the site built against an app
that had not finished deploying and cached a payload without the new field. The app's
"Publish the website now" button rebuilds the site; the nightly rebuild also catches it.

**Twilio has no usable SDK on Workers** (it needs a Node HTTP stack), so `lib/sms.ts`
calls the REST API directly. The delivery callback must be set on the **Messaging
Service**, not on the phone number — with it on the number, the database cheerfully
reported "accepted" while Twilio knew nothing had been delivered. Error 30034 means the
10DLC campaign is not approved; that blocked every message until 2026-09-01.

---

## Operational notes — things applied in the dashboard, not the repo

### Deploying the app — Workers Builds, not GitHub Actions

The app's Worker is connected to this repo through **Workers Builds**, the same
mechanism the public site uses, so a push to `main` that touches `app/**` builds and
deploys it. No API token, no GitHub secrets.

Settings on the `changeme-app` Worker → Settings → Build:

| Field | Value |
|---|---|
| Root directory | `app` |
| Build command | `npm ci && npm run build` |
| Deploy command | `npx wrangler deploy` |

**The root directory is the one that breaks silently.** Left at the repo root, the build
log goes straight from "Cloning repository" to the deploy command — no install, no build,
and `Detected the following tools from environment:` comes back empty, because the repo
root has no `package.json`. `wrangler` then finds no config saying this is a Worker,
guesses the project is a static site, and fails with **"Could not detect a directory
containing static files"**. That message sends you looking for a missing `dist/`; the
real fault is that it is in the wrong folder and nothing was ever built. Cost one failed
build on 2026-09-01.

**Connect git to the EXISTING `changeme-app` Worker.** Do not use "Create application" and
point it at the repo — that makes a *second* Worker, and `app.example.org`
stays attached to the first one, so the site would look unchanged no matter how many
times it deployed. The site has already been bitten by a version of this: its Worker is
named after the Cloudflare project and ignores the `name` in its own wrangler config.

`.github/workflows/check-app.yml` runs `astro check`, the tests and the build on every
push and PR. It does **not** deploy, and needs no secrets. Workers Builds does not wait
for it, so a red X there means "check what just deployed", not "the deploy was blocked".

### Rate limit on `/api/sms/run-due` — APPLY THIS BY HAND

This endpoint is public to the middleware (the cron Worker has no session) and
guarded only by a shared secret. It can trigger real Twilio sends, so it can spend
money. The secret comparison is constant-time in code; a rate limit is the other half,
and Cloudflare rate-limiting rules are zone configuration that cannot live in
`wrangler.jsonc`. Create it once:

**Cloudflare dashboard → example.org → Security → WAF → Rate limiting rules
→ Create rule**

| Field | Value |
|---|---|
| Rule name | `sms-run-due` |
| If incoming requests match | `Hostname` equals `app.example.org` **and** `URI Path` equals `/api/sms/run-due` |
| Characteristics | `IP` |
| Requests | `3` |
| Period | `10 seconds` |
| Action | `Block` |
| Duration | `10 seconds` |

**Those two 10-second values are not a choice — the free plan fixes them.** Pro and above
can set a longer window and a longer block; free cannot, and the dashboard simply offers
no other option. An earlier version of this section specified 5 per minute with a
10-minute block, which is not achievable here.

Be clear about what this buys, because it is less than it looks: with a 10-second block,
someone can send 3 requests, wait 10 seconds and repeat — roughly 9 a minute sustained
rather than unlimited. It caps a flood; it does not stop a patient attacker.

That is acceptable because the rate limit was never the main defence. The secret is 128
bits of randomness compared in constant time, so guessing it is not realistic at any
number of attempts. This rule exists to stop someone burning the Worker's request quota.

The free plan includes exactly one rate-limiting rule, and this uses it — so rate-limiting
anything else later means choosing between them. This is the right one to spend it on: it
is the only endpoint that can spend money.

**Match on the PATH, not the hostname.** The dashboard's free-plan builder offers a `URI
Path` field and no `Hostname` field, and it is easy to put the hostname in the path box —
the rule then matches nothing at all, silently, while showing as deployed. The expression
must read:

```
(http.request.uri.path eq "/api/sms/run-due")
```

Dropping the hostname is safe: that path exists on the app and nowhere else in the zone.
The rule's own **Total requests matched** counter is the tell — if it sits at 0 while
traffic is hitting the endpoint, the expression is wrong.

**Verify it SEQUENTIALLY, not with a parallel burst.** Verified working 2026-09-01: eight
requests about a second apart returned `401 401 401` and then `429` for the rest. The same
test fired as 15 simultaneous requests came back all `401` — Cloudflare's counter is
distributed and cannot keep up with a truly parallel burst, so some of it slips through.
That is a genuine limitation of the protection, not just of the test: it throttles a
sustained flood, not a single instantaneous spike.

To re-test (harmless — a wrong secret is rejected without sending anything):

```bash
for i in $(seq 1 8); do curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "x-cron-secret: wrong" https://app.example.org/api/sms/run-due; sleep 1; done
```

### Security response headers

Both halves send `Content-Security-Policy-Report-Only`, `Strict-Transport-Security`,
`X-Content-Type-Options` and `Referrer-Policy`. The CSP is **report-only**: violations
appear in the browser console and nothing is blocked, so a subtly wrong policy cannot
lock anyone out.

**To enforce**, once you have clicked through with DevTools open and seen no violations:
in `site/public/_headers` rename both `Content-Security-Policy-Report-Only` keys to
`Content-Security-Policy`, and in `app/src/middleware.ts` change `CSP_HEADER` to
`'content-security-policy'`. No report-collection endpoint is configured, so violations
are visible in DevTools only.

**The site uses `site/public/_headers`, not Worker code, and that is not a preference.**
Static assets are matched *before* the Worker runs, so a header set in
`site/worker/index.ts` would never reach an HTML page — the Worker only ever sees
`/api/*`. Workers Assets does honour `_headers`; verified with `wrangler dev` on both an
HTML page and a font file, and `/_headers` itself correctly 404s rather than being
served. Confirm once after the first deploy:

```bash
curl -sI https://example.org/ | grep -i content-security-policy
```

If that comes back empty, `_headers` is not being honoured in production and the
fallback is a **Response Header Transform Rule** (dashboard → Rules → Transform Rules →
Modify Response Header), which runs at the edge ahead of asset matching.

**`/admin` gets its own policy, and the `!` line in `_headers` is load-bearing.** The
CMS loads Decap from unpkg and talks to GitHub, which the site-wide policy forbids.
Rules in `_headers` *accumulate*, and a browser given two CSP headers enforces the
intersection — so without `! Content-Security-Policy-Report-Only` on the `/admin/*`
block, the tight policy goes on blocking unpkg and the CMS breaks with no clue why.

---

## Scheduled and automatic texts

**Writing a text and scheduling one are the same job, so they are one form.**
`/messaging` has a single compose box with one audience picker, one segment meter and a
**when**: send it now, once on a date, or every week. Choosing anything but "now"
reveals a name and the time fields and turns Send into Schedule it. `/messaging/scheduled`
no longer exists as a screen — it was a second form asking the same two questions and
adding only the third.

Sending **now** is intercepted and streamed to `/api/sms/send` in slices, because a
plain form post cannot make the repeated calls the 50-subrequest cap forces. Scheduling
is an ordinary post and goes straight through.

Audience is one of three, read in this order: **named individuals**, then **a group**,
then **everyone who can be texted**. Only the chosen one is stored, because the runner
reads them in that priority order and a leftover group id would silently win. The picker
counts **handsets, not ticks** — a couple sharing a mobile is one phone, which is what
it costs and what arrives — and each checkbox carries an opaque index rather than the
number itself.

⚠️ **In `buildAudience`, an empty list of named people means NOBODY**, where every other
empty value in that function means everyone. Getting it backwards texts the whole church.
It is written into the code rather than left to be found.

**Automatic birthday texts** (a fold at the bottom of `/messaging`) — a switch, a time
of day and the message. NOT a schedule: a birthday text is a standing arrangement, not
something you sit down and arrange each year. Off until switched on. `{first}` is
required in the wording; saving is refused without it, because a birthday text with no
name in it reads like a bulk mailout. The fold opens itself after a save or an error,
because a confirmation nobody can see is not a confirmation.

**Nothing is worked out in advance.** A rule is expanded into per-recipient rows only
when it comes DUE, so the audience is whoever qualifies at send time. That is what makes
birthdays dynamic: dates added to the directory in March are simply found in March,
with nothing to re-create.

### The two rules that keep this safe

**Duplicate prevention is the unique index on `scheduled_messages.source_key`, not a
"have we run yet" flag.** This is load-bearing. Because the database refuses the second
row, a due rule is safely re-expanded on EVERY 5-minute tick inside its one-hour window
— which is how a birthday typed in at 9:20 is caught by the 9:25 tick, and how someone
added to a group after the first tick still gets the text. `last_run_at` is display
only. Gating on it was the first design and it silently dropped anyone whose details
arrived mid-window.

**Sends are capped at 40 per run** (`SENDS_PER_RUN`). A Workers request may make 50
outbound fetches and the 51st fails — the bug that once sent 51 of 75 and dropped the
rest with no error. The remainder stays pending and the next tick takes it.

Times are stored as **local wall clock, not instants**, so 8am stays 8am across a DST
change. Birthdays are matched by parsing month and day out of the string, never
`new Date(iso)`. Leap-day birthdays are wished on the 28th in a common year.

`sms-cron` runs `*/5 * * * *` **and** `0 * * * *`; only the hourly one passes
`?roster=1`, so the roster's Google Sheet is still fetched 24 times a day rather than
288.

## Checking numbers without texting anyone

`/messaging/numbers` runs **Twilio Lookup** over every distinct `phone_e164` and stores
the line type on the person. A **landline cannot receive SMS at all**, which is the
usual meaning of error 30005 — and a number copied off a printed directory is exactly
where a household landline hides.

About half a cent a number; the page states the total before you press anything.
Batched 40 at a time for the subrequest reason above, and one lookup per DISTINCT
number rather than per person, since couples share handsets.

**First full run, 2026-09-04: all 77 numbers came back `mobile`.** So Della
Rowntree's old 30005 was a disconnected or reassigned mobile, not a landline.

**Lookup proves the line TYPE, never that anyone is answering.** A dead mobile still
reports `mobile`. It rules out the landline category; only a delivery report proves
reachability.

## The bulletin pulls three things in automatically

Nothing below is typed by hand, and each is keyed off the bulletin's **own service
date** rather than today — so a bulletin written on Thursday says the same thing when
it is printed on Sunday, and last month's still shows last month.

- **Birthdays and anniversaries** for that month, from the directory. Adults must be
  directory-listed; children are included by age. See `isCelebrant()`.
- **Who is singing**, morning and evening, plus a quieter line for next Sunday. Read
  from the same published sheet that drives the Monday reminder, so the two can never
  disagree. `parseRosterDetailed()` keeps the sheet's columns apart; `parseRoster()`
  flattens them and remains the reminder's input, untouched.
- **This Week and Coming Up**, from the church calendar.

A cell holding a note rather than names ("Revival", "Bring-your-Favorite-Chorus") is
printed as written, not split into people who do not exist. An unreachable sheet yields
null and the section is simply absent — it must never take the bulletin down.

`eventWhen()` omits the date on single-day events because `EventCard` prints a stacked
date block beside it; the bulletin has no such block and passes `withDate: true`. Without
that, "Coming Up" said "Sunday · 6:00 PM" with no way to tell which Sunday.

## Sign-up sheets

Three kinds of paper sheet come off the foyer table: a **meal train** across a span of
days, a **list** of names for an event or a volunteer call, and a **pitch-in** where
staff decide the parts first and people sign up against them.

They are one thing underneath — a list of **slots** with a capacity, that people
**claim**. The kind decides only how the slots get made and what the form asks for.
The public page, the taken/available display, the corrections and the reminders are
written once. There is no third feature here to maintain.

**Built at `/signups`, reached at `/signup/{token}`.** Deliberately not in the website's
menu: the link goes in the bulletin, in a text, or on the link-tree the pew NFC tags
point at. The token is 128 bits, the same as a directory invite.

- `/signups` — the list, and where one is created. Copy the link from here.
- `/signups/{id}` — one page, four sections in the order you think in: what it is for,
  what people are signing up for, who has signed up (editable — the office takes changes
  by phone), and how to share it.
- `/signup/{token}` — the public sheet, on `PublicLayout.astro`. No client JavaScript
  anywhere but the copy button; each open slot is a `<details>` holding its own small
  form. A sheet with one slot does not fold at all — there is nothing to choose between.

**Two families being told they both have Tuesday is the one failure this cannot have**,
so the database is the guard and not a count taken beforehand: `UNIQUE (slot_id, seat)`,
compute the next seat, insert on-conflict-do-nothing, and if nothing comes back somebody
was quicker. That is also why slots are child rows rather than a JSON column like
`bulletins.announcements` — a slot is pointed at by sign-ups made from different phones
at the same moment, so it needs an id that survives an edit to the row above it.

**A sheet shuts itself once every day on it has passed.** Nobody remembers to press
Close, and a link in an old bulletin should not go on collecting meals for a family who
stopped needing them a month ago. A draft renders the same page as a token that never
existed, so the page cannot be used to test tokens.

**Setting the days is a set, not a fill.** Narrowing a meal train's range takes the
dropped days back off — except a day somebody has already claimed, which is never
removed and is called out on the page instead. Undated rows are left alone, and a range
the app refuses (a mistyped year, a backwards span) changes nothing at all.

### The reminder, and the consent obligation

A person can ask to be texted the day before their day. The window runs from **09:00 the
day before to 09:00 on the day** — a grace day, on the same reasoning as the singing
reminder: a cron outage should mean a late reminder, not a silent one. Past that, no text
and a visible `skipped` row. `source_key` is `signup:{id}`, and the unique index on it is
the only thing preventing a second text.

The body is validated as **one GSM-7 segment with the placeholders filled in**, not as
written — `{first}` is seven characters and a real name can be eleven, so a template
approved as typed slips into a second segment for a third of the church, quietly, on
every reminder ever sent.

**This made `signups` a third table holding a phone number and a consent decision**, and
`lib/consent.ts` had said there were two. It has changed, and this is the part to be
careful with:

- A **member whose number is on file and already opted in** has nothing new stored. The
  reminder reads their number from `people` at send time, so a change of number follows
  them and a STOP stops them.
- **Everyone else** gets a tick-box whose *label is the consent wording*. Unticked, or a
  number that has already asked not to be texted, and nothing is stored at all.
- A **STOP now reaches all three tables**, it turns off `remind` (the field the expansion
  actually reads — recording the consent and leaving the flag set is an opt-out that
  reads as handled in the log and texts the person anyway the next morning), and it
  **cancels what is already queued**, which the table updates do nothing about.

## Importing member data (the printed directory, Breeze, anything else)

The CSV and the Breeze export contain real member PII and **must never enter the repo**.
Work in a scratch directory. The 2026-09-04 import went straight into D1 — data, not
code, so no deploy, and the directory showed it immediately.

Four rules, each learned the hard way:

1. **Fill blanks only.** Never overwrite a live value with a printed directory that is
   slightly out of date. List the disagreements and have them decided one at a time.
2. **Never opt anybody in.** New people get consent `unknown` and no `phone_e164`, so an
   import cannot cause a text to be sent.
3. **Check every flag against existing rows.** The first draft would have created new
   people with `include_in_directory=1`, putting six CHILDREN in the member directory.
   Every existing child is 0. Only comparing caught it.
4. **The two sources spell people differently** — Rowntry/Rowntree, Marisa/Marissa,
   Kaylee/Kayleigh, Margery/Marguerite. Fuzzy-match and confirm each, or the import silently
   creates duplicate people.

### The public demo site

Separate from the flag above. **demo.fairhavenchurch.org** is its own
Worker (`changeme-demo`) with its own database of invented people, so a pastor
considering this can click through the whole app without an account and without
seeing anybody real. `DEMO_INSTANCE=1` removes sign-in and refuses every Twilio
call at the point of sending; the Worker also holds no Twilio credentials and no
R2 bucket, so there are two independent reasons a visitor cannot text a real
person.

**It is the one thing here that does NOT deploy on a push.** Bring it up to date
with:

```
cd app && node scripts/refresh-demo.mjs
```

That migrates the demo database, regenerates the invented congregation, builds,
and deploys — in that order, because forgetting the last one is how the demo
came to be running old code with none of the children's-ministry tables, showing
an app with no children's ministry in it.

**A new feature needs seed data as well as code.** `scripts/seed-demo.mjs` is
where the invented congregation lives, and a tab with nothing in it is the same
failure in a milder form. The sign-up sheets seed four of them — part-filled,
nearly full, and one whose days have all passed so it is shut without anybody
having pressed Close — because what is worth showing about that feature is the
states a sheet can be in. Their dates are computed at reseed rather than written
down, so re-running the command above makes them current again.

## Editing content (Decap CMS)

Visit `/admin` on the deployed site (not meaningful on localhost until the OAuth Worker is
deployed and `config.yml` points at it). Log in with a GitHub account that has write access to
the repo.

**Approval workflow (brief §6):** the CMS is configured with `publish_mode: editorial_workflow`
— every edit goes through Draft → In Review → Ready before it's live. This is Decap's built-in
mechanism, not custom code, and satisfies the brief's approval-workflow requirement for
public-facing content edits.

**Adding a sermon** (brief §4 — should be fast): Sermons collection → New Sermon → paste the
YouTube video ID (not the full URL — just the 11 characters after `v=`), fill in title/series/
speaker/date/scripture, publish through the workflow. That's the whole weekly task.

**Ministries**: 4 fixed entries (Fairhaven Kids/Fairhaven Youth/Fairhaven Ladies/Fairhaven Seniors) — edit existing ones rather
than creating new ones. Uncheck "Placeholder content" once real copy/branding lands for
Fairhaven Ladies/Fairhaven Seniors. A 5th (men's ministry) was pulled entirely 2026-08-29 — "Fairhaven Men" reads as an
unintended word — add it back via a new content file once the pastor has a real name for it.

**Livestream override**: Site Settings → Livestream Override. Turn "active" on and paste the
week's URL to force that stream regardless of auto-detection; turn it back off afterward (or
leave off and let auto-detect handle it week to week).

**Homepage banner / media uploads** (brief §1 — "banners and seasonal graphics"): Site Settings
→ Homepage Banner. Upload an image (uses Decap's media library — this commits the file straight
into `site/public/uploads/` via the GitHub API, no server involved), add a headline and optional
link, turn "active" on. Turn it back off when the season/event is over; the image stays in the
repo for reuse next time. **Do not use this uploader for member/people photos** — that is now built and separate: member portraits go to R2 through the person's profile in the app, never into this repo
— anything here is public and served to everyone; private member data needs the actual server
app instead.

Uploads are auto-compressed on every build (`scripts/optimize-uploads.mjs`, wired up as npm's
`prebuild` hook — runs automatically, no manual step) since phone photos land here at 10+ MB and
public/ bypasses Astro's normal image optimization. Resizes to max 2000px wide, re-compresses,
in place — safe to re-run repeatedly, no cumulative quality loss.

---

## Testing the events feed (recurring events + DST)

The brief specifically flags recurring events and DST as failure points. Before trusting this
in production:

1. Add a weekly recurring event to the real "Church Public Events" calendar (e.g. mirror the
   Wednesday 7pm service) and confirm it appears correctly, at the correct local time, on both
   the homepage strip and `/events`.
2. Add a single-occurrence override — edit just *one* instance of that recurring event (move
   it, rename it) in Calendar/Reminders — and confirm only that one instance changes on the
   site, others stay put. This exercises the `recurrences`/override-map handling in
   `src/lib/ical.ts`.
3. Delete/cancel a single occurrence (not the whole series) and confirm it disappears without
   removing the rest of the series (exercises `exdate` handling).
4. Pick a recurring event whose next occurrence crosses a DST boundary (next one: Sunday, March
   8, 2026 — clocks spring forward) and confirm the displayed local time doesn't shift by an
   hour. `src/lib/time.ts` and `src/lib/ical.ts` both lean on `Intl`/the JS engine's IANA tzdata
   rather than manual offset math specifically to get this right automatically — but verify it.
5. Remember the two update paths: the daily cron rebuild (~09:00 UTC) and the manual "publish
   now" deploy-hook link. Also remember iCloud's own feed refresh can lag up to ~1 hour on top
   of whichever rebuild path is used — acceptable per the brief, but worth knowing when
   debugging "why hasn't my edit shown up yet."

## Linking an event to a ministry (#tags)

Put a hashtag in an event's **Notes** in Apple Calendar and the event attaches
itself to that ministry:

```
Games, pizza and a bounce house in the fellowship hall. Bring a friend! #kids
```

That does two things:

1. On the **Events page** the card gains a chip linking to that ministry.
2. On **that ministry's own page** (`/ministries/kids`) the event appears
   under "Coming Up".

One place to type it, two places it lands. The vocabulary is the ministries'
own accent names, so it can't drift out of step with the content collection:

| Tag | Ministry |
|---|---|
| `#kids` | Fairhaven Kids |
| `#youth` | Fairhaven Youth |
| `#seladies` | Fairhaven Ladies |
| `#seseniors` | Fairhaven Seniors |

Details worth knowing:

- **Case doesn't matter.** `#Fairhaven Kids`, `#kids` and `#KIDS` all work — phone
  keyboards autocapitalise.
- **Several tags are fine.** `#kids #youth` puts a joint event under both.
  Under Fairhaven Kids it shows a "Fairhaven Youth" chip and vice versa, so a shared event
  reads as shared; the ministry's own chip is dropped where it would be
  circular.
- **The tag is removed from the text before display.** Nobody reads "#kids"
  in the middle of a sentence.
- **Unrecognised hashtags are left alone.** `#potluck` is someone writing
  prose, not a failed instruction, so it stays as typed rather than vanishing.
- **A word boundary is required**, so `#kidsandmore` is not a tag.
- If the calendar can't be reached at build time, the Ministries page simply
  shows no event blocks — it never fails because of it.

---

## Multi-day events, and the one thing the calendar can't say

Apple Calendar stores an event as a single start and a single end. There is no
way to express "7pm each night" — iCalendar's `VEVENT` is one contiguous
interval. So the September revival is authored as one block running Tue 22nd
7:00 PM to Sun 27th 8:00 PM, when the reality is 7pm nightly plus the normal
service times on the Sunday.

**The span is real; the continuity is an artifact.** The site therefore renders
multi-day events as a DAY RANGE with the start time —

    SEP        Tue 22 – Sun 27 Sep · from 7:00 PM
    22–27      Revival with Jessie Edwards and family

— and never as "7:00 PM – 8:00 PM", which would tell a visitor the event runs
for 121 unbroken hours.

### How to state the real schedule (the pastor)

Put it in the event's **Notes** field in Apple Calendar. It appears under the
event on the Events page, and you can edit it from your phone without anyone
touching code. For the revival, something like:

> 7:00 PM nightly Tuesday through Saturday. Sunday at 10:00 am and 5:30 pm.

This is the only place that detail can live, because the calendar format
genuinely cannot carry it.

**Adding Notes also changes the line above the title.** A multi-day event with
Notes shows just the day range ("Tue 22 – Sun 27 Sep"); the derived start time
is dropped, because it would contradict the Notes — the revival starts at 7pm
on weeknights but 10am on the Sunday, and "from 7:00 PM" sitting directly above
"Sunday 10 AM and 5:30 PM" is the exact confusion this is meant to prevent.
With no Notes, the start time stays as the best available hint. Notes appear on
both the Events page and the homepage strip.

An alternative, if you ever prefer it: author the revival as a *recurring*
7:00 PM event Tue–Sat plus separate Sunday entries. That is semantically
correct and the site already expands recurring events, but it is more setup
each time and would currently render as one row per night.

### The edge cases this handles

All verified against a synthetic feed (`multiDay`/`lastDay` in `src/lib/ical.ts`):

| Case | Renders as |
|---|---|
| All-day, one day (`DTEND` is the *next* day — exclusive) | "Tuesday · All day", NOT a two-day span |
| All-day, several days | "Tue 22 – Sun 27 Sep · All day" |
| Timed, one day | "Tuesday · 7:00 PM" |
| Timed, several days | "Tue 22 – Sun 27 Sep · from 7:00 PM" |
| Timed, ending exactly at midnight | Stays on the starting day |
| Span crossing a month boundary | "Wed 30 Sep – Fri 2 Oct"; the date block shows the start only |

---

## Testing the livestream page

`/livestream` has built-in test hooks — no need to actually go live to test:
- `/livestream?test=live` — forces the "we're live" view with a sample video
- `/livestream?test=offline` — forces the countdown/fallback view
- `/livestream?test=override` — forces the manual-override view

**Verified for real on 2026-08-31** against an unlisted test stream on the church channel,
end to end on production — not just the endpoint:

| | Observed |
|---|---|
| Before going live | `{ live: false, configured: true }`, page shows the countdown |
| Stream started | Detected in **under 20s**; page swapped to the embed with the correct video ID and the "We're live now" badge |
| Stream ended | Released in **~100s** — page back to the countdown |

That last row is the one worth re-testing if this is ever changed. A detector that latches on
and never releases would leave the page claiming a service is running all week, and it is the
failure nobody would think to look for.

Timing to expect: detection is bounded by the 90s edge cache plus YouTube's own lag, so
"within about two minutes" either way is normal and not a fault.

Still untested against a real stream: the Decap CMS manual override taking precedence while
auto-detection is also reporting live. The code path is simple (the override returns before
the fetch), but it has not been exercised on a live broadcast.

---

## Sermons: a rolling window, not the whole catalogue

The site carries the **last 6 months** of services. Everything older stays on
YouTube, and the Sermons page links out to it. the pastor's call, and the right one:
four years is ~600 pages nobody browses, when people looking for an old service
go to YouTube anyway.

`SERMON_WINDOW_MONTHS` in `src/lib/content.ts` is the single knob. It is
evaluated at BUILD time, so the window slides on its own — the nightly rebuild
drops whatever has aged out, with nothing to run or remember. Ageing out only
HIDES a service; the markdown file stays, so widening the window brings entries
straight back.

### Titling uploads on YouTube (the bit that matters)

Everything the site knows about a service comes from its YouTube title, so the
titling convention IS the data entry. Use pipes:

```
August 23, 2026 | Sunday Morning Worship | Pastor [Pastor Name] | The Narrow Gate
     date       |        service         |       speaker        |  sermon title
```

- **Date and service are required**, in that order, always first.
- **Speaker and sermon title are optional** — but keep the order.
- Got a sermon title but no speaker? Put a dash in the speaker slot:
  `August 23, 2026 | Sunday Morning Worship | - | The Narrow Gate`.
  Without it, the title would be read as the speaker's name.

The pipe is deliberate: it never turns up in ordinary prose the way a hyphen
does, and it's far easier to type than an em dash. Spacing around it doesn't
matter.

Titles with no pipes fall back to the **legacy** form
(`August 23, 2026 Sunday Morning Worship`), which is what older uploads use —
they keep working, they just carry no speaker or sermon title.

Adding a speaker or sermon title upgrades the entry automatically: the sermon
title becomes the card heading with the service label dropping to the kicker.

### Automatic import

`.github/workflows/import-sermons.yml` runs daily at 09:00 UTC, imports
anything new, prunes what's aged out, and commits — which triggers the
Cloudflare build. It can also be run by hand from the repo's Actions tab.

**No API key or secret is involved.** It reads YouTube's public RSS feed, which
returns the ~15 most recent uploads — enough to stay current indefinitely, since
it runs daily. (The archive therefore fills to the full 6-month window over
time rather than all at once.)

The job checks out the **tip of `main`** rather than the commit that triggered
the run, and rebases onto origin before pushing. Without both, a run started
from a stale page — or one queued behind a push — commits on an old base and
the push is rejected as non-fast-forward. That is how the first real run
failed, after everything else in it had worked.

The job runs the importer with `--strict`, which is the safety net that matters
unattended: if the channel's titling changes and nothing parses, the run FAILS
rather than silently committing nothing while the archive quietly goes stale.
A red X in the Actions tab is the intended signal.

### Importing by hand

```bash
cd site
node scripts/import-sermons.mjs --dry-run                       # rehearsal, no key needed
YOUTUBE_API_KEY=... node scripts/import-sermons.mjs --dry-run   # read the report first
YOUTUBE_API_KEY=... node scripts/import-sermons.mjs --write     # then write
```

Flags: `--months N` (default 6, matches the site) · `--limit N` (only the N most
recent) · `--prune` (delete files that have aged out) · `--force` (overwrite
existing entries). Re-running is safe: filenames derive from date + service
type, so existing entries are left alone.

**Verified end to end on 2026-08-30.** A run imported a service, committed as
`github-actions[bot]`, pushed, and Cloudflare rebuilt — so the whole chain
works with nobody touching anything. Note the commit and the deploy are not
simultaneous: the bot commit lands at once, the build takes a minute or two.

Two things that had to be fixed to get there, both worth knowing if this ever
breaks again:

- **The RSS feed is CDN-cached for 15 minutes.** The importer sends a
  cache-busting query string. Without it, renaming a video and importing
  straight afterwards silently reads the OLD title.
- **A re-run replays the original commit's workflow file.** After changing the
  workflow you must start a NEW run from the workflow's own page; re-running a
  failed run will keep failing identically forever.

### What the channel contains — this drove the design

Every upload is named `"August 23, 2026 Sunday Morning Worship"`. There is **no
sermon title, speaker, scripture or series anywhere** in the metadata;
descriptions are boilerplate Restream text. It is an archive of full SERVICE
recordings, not titled sermons, and the page and schema match that.

Three findings from the real feed, each of which breaks the obvious import:

1. **The upload date is not the service date** — it lags 1–8 days, sometimes
   into the following week. The date is parsed from the TITLE. An unparseable
   title is skipped and reported, never guessed.
2. **Restarted livestreams leave duplicates.** 15 uploads collapsed to 10 real
   services in one six-week sample, and a single Sunday had **five**. Collapsed
   on (date + service type), keeping the LONGEST recording — which is what the
   API key buys, since durations make that choice trustworthy rather than
   arbitrary. Every collapse is printed for spot-checking.
3. **`speaker` used to be required** and would have failed every entry. Now
   optional, with title/series/scripture.

### Enrichment is optional and graceful

An imported entry shows the service label as its heading with the service type
as the kicker. Add a `title` in the CMS and it becomes the heading; add a
`series` and the entry joins a series page automatically; add `speaker` or
`scripture` and they appear. Nothing needs enriching for the archive to work —
filtering is by service type and year, both derived.

### Known limitation

Every video uses the same branded stream thumbnail, so the grid shows the same
image on every card. the pastor chose to keep them rather than substitute rotating
church photos (which would look varied but wouldn't depict the actual service).
Revisit if it grates.

---

## Extending the sermon filters

`/sermons/series/[series]/[...page].astro` is a complete, working pattern for a faceted,
paginated sermon list. Adding a `/sermons/speaker/[speaker]/[...page].astro` facet later is a
direct copy of that file with `speaker` substituted for `series` throughout.

---

## PWA status — installable, deliberately not offline

Manifest and icons are in place (`site/public/manifest.webmanifest`,
`site/public/icons/`), so the site installs to a phone home screen and opens like an
app. That is the whole of it, and it is what the pastor asked for: "I don't want an app —
can I just have people put icons on their home screens?"

**There is no service worker and there will not be one unless someone changes their
mind.** `/sw.js` returns 404 by design. The brief scoped full offline caching as Phase
2; the pastor dropped it (2026-09-01) because signal in the sanctuary is fine and the church
is in town. If you are looking for the offline layer, it was not forgotten — it was
declined. Adding one later is a self-contained job that touches nothing else.

---

## What is deliberately NOT built

Only two things, and both are decisions rather than gaps:

- **PWA offline caching** — declined, see above.
- **A men's ministry page** — pulled entirely 2026-08-29. The brief listed Fairhaven Men
  alongside Fairhaven Ladies and Fairhaven Seniors; the name reads badly written down. Four ministries
  exist: Fairhaven Kids, Fairhaven Youth, Fairhaven Ladies, Fairhaven Seniors.

Everything else in the brief is built. If some other part of this document says a
feature is "not built yet", that sentence is older than the feature — check the running
system before believing it.

---

## Still outstanding (content, not code)

- [ ] **Fairhaven Ladies photo, and real branding (logo + colours) for Fairhaven Ladies and Fairhaven Seniors.**
  They run on the brief's provisional palette values. Nothing shows a marker on the
  site — a ministry without a logo simply shows none, and a card without a photo shows
  a panel tinted in that ministry's colour — so this is tracked here rather than
  advertised on a public page.
- [ ] **Five directory-listed adults still have no textable number**, so they cannot be
  sent a directory invite and must be handed a link another way. Down from fifteen after
  the 2026-09-04 import.
- [ ] **Some singers on the rota are still not in the people database.** The Monday
  reminder can only text people it can find and skips the rest with a note rather than
  guessing, so a gap is silent unless you read the dashboard. Della Rowntree is now
  present, with her number corrected.
- [x] ~~Two junk records (#23 "Sim Not sure", #26 "Sm Sure not")~~ — archived 2026-09-04.
- [ ] **The birthday texts are built but switched OFF.** Put the wording in and turn
  them on at `/messaging`. Straight quotes, not curly: a smart apostrophe makes the
  message three segments and triples the cost of every birthday text ever sent.

## Going live on the domain — what actually happened, 2026-08-31

Cutover done. Nameservers moved from Network Solutions to Cloudflare
(`dante`/`romina.ns.cloudflare.com`), apex and www attached to the Worker as
custom domains, `site:` in astro.config.mjs moved to the real origin.

Three things worth keeping:

**Cloudflare's import scan got the zone wrong, and it looked fine.** It missed
seven A records (`email`, `webmail`, `ftp`, `imap`, `mail`, `pop`, `smtp`) and
rewrote the MX. Nothing appeared broken, because the wildcard it *did* import
answered for every missing name — with the wrong IP. If this zone had needed
preserving rather than replacing, that would have shipped silently. The
registrar's own record list is the only trustworthy inventory.

**A www→apex redirect cannot live in the Worker.** Static assets are matched
before the Worker runs, so a page request on www is served straight from dist/
and never reaches Worker code. This was tried and returned 200 instead of 301.
The canonical tag in BaseLayout handles the duplicate-origin problem instead.
A real 301 needs a Cloudflare **Redirect Rule**, which runs at the edge ahead
of asset matching.

**The site had no canonical tags at all** until the cutover forced the issue.
Worth remembering that `site:` in astro.config.mjs only matters if something
actually reads it.

Mail is closed off: null MX, `v=spf1 -all`, DMARC `p=reject`. The day the
church wants real mailboxes on the domain, all three change together or
`p=reject` silently bins the new sender.

The old Network Solutions records were left in place deliberately — they cost
nothing and are the only rollback. Clean them up once the site has been happy
on the new domain for a week or two. Tithely and the HostGator account can be
cancelled at the same point, and not before.
