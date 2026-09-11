# Setting this up for your church

A complete church website and a private members' app, built to be run by a
volunteer rather than a developer. This document takes you from an empty
Cloudflare account to a live site.

**Read this first, in full, before you start.** It is long because it is
honest about the parts that are fiddly. The build itself is mostly filling in
your own details.

---

## What you get

**A public website** — Home, About (with beliefs, "I'm new", and staff),
Ministries, Sermons, Events, Livestream, Contact, Give, and a weekly Bulletin.
The sermon archive imports itself from YouTube every night. The events page
reads your existing calendar. The livestream page knows when you are live and
shows a countdown when you are not.

**A private staff app** on its own subdomain — the people database, attendance
and visitor check-in, groups, trends, a bulletin editor that publishes to the
website, and text messaging: broadcasts, replies, scheduled texts, and
automatic birthday texts.

**A members' directory** members reach by a personal link texted to them, with
photos, and which each member can edit for themselves.

## What it costs

| | |
|---|---|
| Cloudflare (hosting, database, storage, cron) | **free** at this size |
| Domain name | ~$10–15/year |
| Web3Forms (contact + prayer forms) | **free** |
| Zeffy (online giving) | **free** — takes no cut |
| Google Cloud (YouTube API, staff sign-in) | **free** at this volume |
| Twilio (texting) | pay as you go — **a few dollars a month** for a church of ~150 |

Texting is the only meaningful cost: roughly a cent per person per message.
Everything else fits inside free tiers and is not close to the limits.

## How long it takes

Plan on **a few evenings**, not a weekend marathon, and note that two steps
involve waiting on someone else:

- **Twilio 10DLC registration takes days to approve.** Start it early. Nothing
  sends until it clears, and every message fails with error 30034 meanwhile.
- **DNS changes take hours to propagate.**

Everything else you control.

---

## Before you start: accounts to create

Create these first. Each is free to open.

1. **GitHub** — where the code lives. Make it an account the *church* owns, not
   your personal one. A future volunteer will need it.
2. **Cloudflare** — hosting, database, storage. Same advice: church-owned.
3. **A domain** — from Cloudflare directly if you are buying a new one, which
   saves a nameserver step later.
4. **Google Cloud** — free project, for the YouTube API and staff sign-in.
5. **Web3Forms** — free key for the contact and prayer forms.
6. **Twilio** — only if you want texting. Start the 10DLC registration the day
   you open it.

You will also want, before you write any copy:

- **Photographs of your own church.** The single biggest difference between a
  site that looks like yours and one that looks like a template. See
  `site/src/assets/photos/README.md` for the shot list.
- **Your logo**, ideally with transparent background, in a light and a dark
  version.
- **Your service times**, address, phone and the email you want forms to reach.

---

## A note for whoever is doing the building

If you are an AI agent working through this, or a volunteer following along:

**This template ships as a working, finished-looking site for an invented
church — Fairhaven Community Church.** That is deliberate: you can run it and
click through a complete site before changing anything, rather than judging a
design from grey boxes.

Everything of Fairhaven's is therefore something to replace. To find it all:

```bash
grep -rni "fairhaven\|meadowbrook\|changeme\|YOUR-SUBDOMAIN\|example.org\|555-0142" \
  site/src app/src workers --include="*.astro" --include="*.ts" --include="*.yaml" --include="*.jsonc" --include="*.toml"
```

That one word is the spine of it: the church name, the four ministry names
(Fairhaven Kids, Youth, Ladies, Men, Seniors) and the play currency
(Fairhaven Bucks) are all "Fairhaven" plus a noun, so a single find-and-replace
across the repo gets you most of the way.

Then replace the brand artwork, which no find-and-replace can touch:

| file | what it is |
|---|---|
| `site/src/assets/brand/church-mark.png` | the symbol — icons are generated from this |
| `site/src/assets/brand/wordmark-on-light.png` / `-on-dark.png` | the church name set as a logo |
| `site/src/assets/brand/{kids,youth,men}-*.png` | ministry wordmarks |
| `app/public/kids-logo-white.png`, `kids-crown-white.png` | the children's section header |

After swapping `church-mark.png`, run `node scripts/generate-icons.mjs` from
`site/` to rebuild every favicon and PWA icon from it.

**Every photograph is generated and depicts nobody real.** Replace them all —
see `site/src/assets/photos/README.md`.

**Step 3a is a question for the pastor, not a decision for you.** Four design
directions ship with this template; show them, and let them pick.

**Work in the order below.** Later steps depend on earlier ones — the app needs
a database before it deploys, texting needs a Twilio number before the opt-in
section will render, and the site's bulletin page reads the app's API at build
time, so the app must deploy before the site rebuilds.

**Verify each step before moving on.** Every section ends with how to check it
actually worked. Most of the expensive mistakes on the original build were
things that *looked* fine — a secret saved to the wrong Worker, a rate-limit
rule that matched nothing, a cache header silently rewritten. Running something
is not the same as checking it did what you meant.

**`docs/ARCHITECTURE.md`** is the original build log: every decision with its
reasoning, and every trap that cost real time. When this file says "and here is
why", that is where it is.

---

# Part 1 — The public website

## Step 1. Get it running on your own machine

```bash
git clone <your repo>
cd site
npm install
npm run dev
```

Open http://localhost:4321. You will see the site with placeholder text and no
photographs. That is expected — nothing is broken.

**Check:** the site loads and you can click every page in the navigation.

## Step 2. Your church's facts

Everything on the public site reads from **one file**:
`site/src/content/settings/site.yaml`.

Fill in the church name, address, phone, email, service times and social links.
Leave `smsNumber` empty for now — an opt-in section with no number to text
would fail the carrier review it exists to pass. Leave `youtubeChannelId` and
`calendarFeedUrl` empty too; they come later.

**Service times drive real behaviour**, not just a page: the livestream
countdown and the bulletin both compute from them. Use 24-hour local time.

**Check:** `npm run dev`, and your church's name and times appear on the home
page and in the footer.

## Step 3. Photographs

Read `site/src/assets/photos/README.md` — it lists every filename, what the
shot is, and where it appears. Keep the names, swap the images.

Three things worth saying plainly:

**Crop to about 2400px wide.** Astro generates every smaller size automatically.
A 6000px original is 10MB committed to serve 2400px of it.

**Get consent before you publish a face, and ask a parent about a child.**
This is the one part of the whole build most likely to hurt somebody, and no
amount of code makes it safe. Some churches photograph only backs of heads and
wide shots for children's ministry; that is a perfectly good answer.

**A missing photo is not a broken page.** A ministry without one shows a panel
tinted in its own colour. So ship without them and add them as you get them,
rather than delaying the site.

Logos go in `site/src/assets/brand/` — see the README there, especially the
part about trimming the transparent margin, which cost the original build a day.

**Check:** photos appear, and none of them look stretched or badly cropped. If
a face is cut off, that is `object-position` — see "Where to hold the crop" in
`site/src/lib/ministry-assets.ts`.

## Step 3a. Choose a design direction  ← A REAL DECISION, MAKE IT NOW

Four directions ship with this template. They are not colour schemes bolted on
at the end — each is a palette, a type pairing and a corner treatment that hold
together, and every one has been checked so that **every text/background pair
meets WCAG AA (4.5:1)**. Pick one before you write copy or shoot photographs;
it changes what a good photograph for this site looks like.

| | Feel | Type | Suits |
|---|---|---|---|
| **Sanctuary** | Warm cream, ink, deep red. Editorial and quiet. | Instrument Serif + Inter | An established, traditional congregation |
| **Open** | Near-white, deep slate, sage-teal. Airy, soft corners. | Outfit + Inter | A contemporary church with young families |
| **Heritage** | Warm ivory, deep navy, old gold. Formal, crisp. | Playfair Display + Source Serif | A historic or liturgical church |
| **Plain** | White, near-black, one hot accent. Square, confident. | Space Grotesk + Inter | A church plant or younger congregation |

Look at them before deciding — `docs/theme-sanctuary.png`, `docs/theme-open.png`,
`docs/theme-heritage.png`, `docs/theme-plain.png`.

**To choose one, change ONE line** in `site/src/styles/tokens.css`:

```css
@import './themes/open.css';     /* was ./themes/sanctuary.css */
```

That is the whole switch. Fonts, palette, corner radius and the ministry accent
ramps all come from the theme file, so nothing else needs touching and no page
CSS changes.

### If you are the agent doing this setup

**Ask the pastor which of the four they want, and show them the four PNGs.**
Do not choose on their behalf and do not invent a fifth. This is one of the few
decisions on this whole build that is genuinely theirs — it is the thing their
congregation will see every week, and it is not a technical question.

Useful things to say while asking:

- **Sanctuary** is the safest. It was the original build and it flatters
  ordinary photography, because cream is forgiving in a way white is not.
- **Plain** is the least forgiving. With weak photographs it reads as empty
  rather than clean. Only suggest it if they have good pictures or will get them.
- **Heritage** wants a building. If the church meets in a school hall, it will
  feel like a costume.
- **Open** is the one to suggest if their honest answer to "who is this site
  for?" is young families deciding whether to walk in.

Then, having chosen, **design the rest of the site within that direction**:

- **Use the theme's tokens, never new colours.** `var(--ink)`, `var(--paper)`,
  `var(--accent)`, `var(--paper-deep)`, `var(--hair)`. A hex code written
  directly into a page is a bug — it will not follow if the theme changes, and
  the contrast has not been checked.
- **`--accent-tint` exists for dark grounds only.** The accent itself does not
  have 4.5:1 against ink in any of the four; the tint does. Using the accent on
  a dark panel is the commonest way to fail contrast here.
- **Hierarchy comes from size and space, not from adding colour.** Every one of
  these palettes has exactly one accent on purpose. A second accent is how a
  church website starts to look like a leaflet.
- **Match the corner radius.** Sanctuary is 3px, Open 10px, Heritage 2px, Plain
  0px, and it is load-bearing: rounded cards in Heritage or square ones in Open
  read as a mistake even to someone who cannot say why.
- **Respect the display face's weight.** Instrument Serif has no bold at all —
  in Sanctuary, hierarchy has to come from size. Space Grotesk in Plain is set
  heavy by default and should not also be enlarged much.
- **Check any new pair you introduce.** 4.5:1 minimum for text. If you add a
  colour, prove it rather than eyeballing it.

**To add a fifth direction**, copy a theme file, change the tokens, and check
every pair against 4.5:1 before shipping it. The four supplied were checked
this way and two had to be darkened to pass.

## Step 4. Your ministries

Five starters are in `site/src/content/ministries/` — kids, youth, men, women,
seniors. Edit the ones you have, delete the ones you do not.

**To rename or remove one**, three files must agree, and the build will tell
you if they do not:

1. `site/src/content/ministries/<slug>.md` — the page itself
2. `site/src/content/config.ts` — the `accent` list
3. `site/src/lib/ministry-tags.ts` — the calendar tag vocabulary
4. `site/src/styles/tokens.css` — its two colours

Set `placeholder: true` while the copy is provisional. It shows a visible
marker rather than letting draft text quietly read as final.

**Check:** `npm run build` succeeds. A mismatch between those files fails the
build loudly, which is the point.

## Step 5. The contact and prayer forms

Get a free key at [web3forms.com](https://web3forms.com), registered to the
address in `site.yaml`. Paste it into `WEB3FORMS_ACCESS_KEY` at the top of
`site/src/pages/contact.astro`.

It is a **submit-only public key** — it ships in the page source deliberately
and grants no account access. It is not a secret and does not belong in one.

Forms were chosen over sending mail from a Worker for one reason: sending mail
means SPF, DKIM and DMARC records on your domain, and getting those wrong
silently sends your church's email to spam. A relay needs no DNS changes at all.

**Check:** submit both forms and confirm the messages arrive. Do this before
launch, not after — a silently broken contact form is the worst kind, because
visitors think they have reached you.

## Step 6. Sermons and the livestream

Both need your **YouTube channel ID** — the `UC…` string, not your `@handle`.
Find it at [YouTube advanced settings](https://www.youtube.com/account_advanced).
Put it in `site.yaml` as `youtubeChannelId`.

Then create a **Google Cloud project**, enable the **YouTube Data API v3**, and
make an API key. You will use it twice: as a GitHub Actions secret for the
nightly sermon import, and as a Cloudflare secret for live detection.

### Titling your uploads so the site can read them

**This is the highest-leverage five minutes in the entire setup.** The importer
can only know what your video titles say. Title them like this:

```
September 6, 2026 | Sunday Morning | Pastor Smith | Hope That Holds
```

and every sermon arrives with its date, service, preacher and title filled in.
Title them `Live Stream` and you get a dated entry with nothing else, forever.

You can enrich entries by hand later in the CMS, one at a time — but the five
minutes spent settling a title format now saves that entirely.

### How live detection works

`/api/live-status` reads your channel's uploads playlist and asks whether
anything is currently broadcasting. Measured against a real service, it tracks
YouTube within about 30 seconds, and the page picks it up within a minute.

A manual override in the CMS always wins, for the day it does not work.
**Remember to switch the override off afterwards** — it is the likeliest reason
the page shows the wrong video.

**Check:** go live on YouTube, wait two minutes, and confirm the page switches
from countdown to player on its own. Then stop the stream and confirm it goes
back within a few minutes.

## Step 7. Events from your calendar

The Events page reads a published calendar feed. In Apple Calendar, share a
calendar publicly and copy the `webcal://` URL; change it to `https://` and put
it in `site.yaml` as `calendarFeedUrl`.

**Link an event to a ministry** by putting `#kids` or `#youth` anywhere in the
event's Notes. The tag is stripped before display and the event appears on that
ministry's page. Typed on a phone while you are creating the event, which is
the only place it would ever actually get done.

**Check:** add a recurring weekly event and a one-off, rebuild, and confirm both
appear with the right dates. Test one that crosses a daylight-saving boundary
— that is where calendar feeds usually go wrong.

## Step 8. Deploy the site

In Cloudflare: **Workers & Pages → Create → Connect to Git**, choose the repo.

| Setting | Value |
|---|---|
| Root directory | `site` |
| Build command | `npm run build` |
| Output directory | `dist` |

Add `YOUTUBE_API_KEY` as a Worker **secret**.

Then add your domain as a custom domain, and update `site/wrangler.jsonc` and
`site/astro.config.mjs` with it.

**Check:** the live URL serves your site, and `/api/live-status` returns JSON
with `configured: true`.

## Step 9. Editing the site without touching files

The site's words and pictures live as text files in this repository. The staff
app edits them for you — a save is a commit, and the commit triggers the build,
so **a change publishes itself in about two minutes** with nothing else to press.

That needs one credential.

**Create a fine-grained token.** GitHub → your avatar → Settings → Developer
settings → Personal access tokens → **Fine-grained tokens** → Generate new token.

Signed in as the account that OWNS the repository — a token belongs to whoever
makes it, and one made on a personal account stops working when that person
leaves.

| Field | Value |
|---|---|
| Repository access | **Only select repositories** → this one |
| Permissions | **Repository permissions → Contents → Read and write** |

**Contents is the only permission it needs.** Leave every other one at "No
access". If you find yourself granting Administration or Actions, something has
gone wrong — the app only ever reads and writes files.

GitHub shows the token once. It starts `github_pat_` and is about 93 characters.

**Store it on the app's Worker**, from the `app` folder:

```bash
npx wrangler secret put GITHUB_TOKEN
```

Paste it at the prompt. Secrets take effect immediately and survive later
deploys, so there is nothing to redeploy.

**Check:** open `/website` in the staff app. If the token is wrong, that page
says so and tells you how — length, prefix and repository — rather than failing
with a bare 401 somewhere else.

Then `/website/settings` should show your real service times.

### What you can edit there

| Screen | What it changes |
|---|---|
| Right now | The livestream override and the homepage banner |
| Service times & contact | Name, address, times, socials, giving links |
| Staff & leadership | Who appears on the about page |
| Ministries | Each ministry page, including where to hold the photo crop |
| What we believe | The articles of faith |
| Sermons | Titles, speakers, series, and approving a cleaned transcript |
| Photos | Every picture, resized in your browser before it is sent |

It is **admin-only**. Editors can do everything else in the app but cannot
publish to the public website. If that is wrong for your church, it is one line
in `app/src/lib/permissions.ts`, and the reasoning is written beside it.

> **This replaced Decap CMS.** Earlier versions of this template shipped a
> git-backed CMS at `/admin` with its own OAuth proxy Worker, a GitHub OAuth App,
> two more secrets, and a step whose own instructions had to warn that a mistake
> *fails silently in the browser console*. In the church this was built for it
> was used exactly once. One token replaces all of it.

## Step 10. Create the database and storage

```bash
cd app
npm install
npx wrangler d1 create changeme-app          # copy the database_id it prints
npx wrangler r2 bucket create changeme-photos
```

Put the name and `database_id` into `app/wrangler.jsonc`, along with your app
subdomain. **A binding to a bucket that does not exist fails every deploy**, so
create the bucket before you deploy, not after.

Then create the tables:

```bash
npx wrangler d1 migrations apply changeme-app --local     # your machine
npx wrangler d1 migrations apply changeme-app --remote    # production
```

**Check:** `npx wrangler d1 execute changeme-app --remote --command "select name from sqlite_master where type='table';"`
lists people, groups, bulletins, message_log and the rest.

## Step 11. Staff sign-in

Staff sign in with Google. In your Google Cloud project, create an **OAuth 2.0
Client ID** (Web application) with the redirect URI:

```
https://app.example.org/auth/callback
```

Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` as Worker secrets.

Sign-in is allow-listed, not open — a Google account is not enough by itself.
The first account is added directly:

```bash
npx wrangler d1 execute changeme-app --remote \
  --command "insert into staff_users (email, role, active, created_at) values ('you@example.org','admin',1,datetime('now'));"
```

After that, admins add colleagues from the **Access** tab.

**Check:** sign in. Then sign in with an account you have *not* added and
confirm it is refused.

## Step 12. Deploy the app

Same as the site, with different settings:

| Setting | Value |
|---|---|
| Root directory | `app` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

**Two traps here, both of which cost real time on the original build:**

**Leave the root directory at the repo root and the build silently does the
wrong thing** — no `package.json` is found, your build command never runs, and
wrangler guesses it is a static site. The error is "Could not detect a directory
containing static files", which does not sound like what it is.

**A secret added in the dashboard does nothing until a build promotes it.** It
creates a new version while live traffic stays on the old one, so the endpoint
keeps reporting the secret is missing while it sits right there in the UI. Push
any commit — an empty one works.

**Check:** the app subdomain loads a sign-in page and your account gets in.

## Step 13. Import your people

If you use Breeze, export to CSV — `docs/breeze-export-notes.md` records the
column format. Otherwise a spreadsheet with names, phones and emails is fine.

**Four rules, each learned the hard way:**

1. **Fill blanks only.** Never overwrite a live value with an export that is
   slightly out of date. List the disagreements and decide them one at a time.
2. **Never opt anybody in.** Create people with consent `unknown` and no
   texting number, so an import cannot cause a message to be sent. Consent is
   something a person gives, not something a spreadsheet implies.
3. **Check every flag against existing rows** before a bulk insert. On the
   original build the first draft would have created children with
   `include_in_directory = 1`, putting them in the member directory. Comparing
   against existing records caught it; nothing else would have.
4. **The same person is spelled differently in different sources.** Fuzzy-match
   names and confirm each one, or you silently create duplicate people.

**The export file contains real member PII — names, addresses, birthdates,
phone numbers. It must never be committed to the repo.** Keep it out of the
project folder entirely.

**Check:** counts match your expectation, and spot-check five records against
the source. Then check that no children are in the directory:

```
select count(*) from people where adult_child='child' and include_in_directory=1;
```

That must be zero.

## Step 14. Texting

**Start the 10DLC registration first — it takes days.** Until it clears, every
message fails with error **30034** and nothing tells you why in plain language.

In Twilio: buy a local number, create a **Messaging Service**, add the number
to it, and register a 10DLC campaign describing your church's use.

Worker secrets:

| Secret | Notes |
|---|---|
| `TWILIO_ACCOUNT_SID` | identifies the account in the request URL |
| `TWILIO_AUTH_TOKEN` | or an API key pair, which is better practice |
| `TWILIO_MESSAGING_SERVICE_SID` | send through the service, not the number |
| `TWILIO_FROM_NUMBER` | your number in E.164 |

**Set the delivery callback on the Messaging Service, not on the phone number.**
With it on the number, the app cheerfully reports "accepted" while Twilio knows
nothing was ever delivered. Point it at `https://app.example.org/api/sms/webhook`.

Then put your number into `site.yaml` as `smsNumber`, which makes the opt-in
section appear on the public Contact page. Carriers check that page exists.

### Consent is the part to get right

**Only people marked `opted_in` with a usable number are ever texted.** Opting
out is absolute and checked before anything else. An import never sets consent,
and choosing somebody by name in a scheduled text does not override their
opt-out — it simply reaches fewer people than it names.

This is not only good manners. It is what the carrier registration asserts you
do.

**Check before you send to everybody:** send one message to yourself, confirm
it arrives, and confirm the delivery status reaches the app. Then use the
**Numbers** tab to check every number *without* texting anyone — Twilio Lookup
reports whether each is a mobile, a landline or not a real number. A landline
can never receive a text however opted-in its owner is, and numbers copied off
a printed directory are exactly where household landlines hide. About half a
cent per number.

## Step 15. The cron workers

Two small Workers do the scheduled work. Deploy each with `npx wrangler deploy`
from its own folder:

- `workers/rebuild-cron` — rebuilds the site daily so dated content stays fresh
- `workers/sms-cron` — wakes the app every 5 minutes for scheduled and birthday
  texts, and hourly for the singing reminder

`sms-cron` needs `SMS_CRON_SECRET` as a secret, matching one of the same name
on the app. The endpoint it calls is public to the middleware and guarded by
that secret alone.

**A trap worth knowing:** `wrangler deploy` **replaces** a Worker's plain
variables with whatever the config file declares. Secrets survive; variables do
not. Declaring none in `wrangler.toml` wiped `APP_URL` on the original build and
every cron tick failed with `Invalid URL: undefined/...`. Keep variables in the
`.toml`, so the deploy that would erase one is the deploy that restores it.

**Check:** `npx wrangler tail sms-cron` and watch a tick. You want
`run-due -> 200` with no error.

---

# Part 3 — The weekly things

## The bulletin

Written in the app, published to the website. Three sections fill themselves in,
all keyed off the bulletin's **own service date** rather than today — so one
written on Thursday says the same thing when it is printed on Sunday.

- **Birthdays and anniversaries** for that month, from the directory
- **Who is singing**, morning and evening, plus a quieter line for next week
- **This Week and Coming Up**, from your calendar

**Prayer requests carry over** to next week's bulletin; announcements do not.
That asymmetry is deliberate. An announcement is stale by the following Sunday.
A request for somebody's health is not, and making the church retype the same
names every week is exactly how a name quietly stops being prayed for. Each
request shows how many weeks it has been carried, so a long-standing one is
visible — but nothing ever expires on its own. Clearing the line is the only
removal, because deciding to stop praying for someone is a decision for a
person, not a rule.

**Adapting it to your context:** the sections live in
`app/src/pages/bulletin/[id].astro` (the editor) and
`site/src/pages/bulletin.astro` (what is printed). To add a section — an order
of service, a missions focus, a hymn list — add a column in a migration, a
field in the editor, and a block in the page. `docs/ARCHITECTURE.md` walks the
existing ones.

**One ordering trap:** the public bulletin fetches the app's API at **build**
time and bakes the answer in. Adding a field means deploying the **app first**,
then rebuilding the **site**. Both from one push and the site builds against an
app that has not finished deploying, and caches a response without your new
field. "Publish and put it live" in the editor does both in the right order.

## The singing schedule

A published Google Sheet, first column the Sunday's date, every other column
holding names:

```
Sunday      | AM                        | PM
2026-09-06  | Ada Aldridge, Tom Aldridge | Peter Kingsley
```

One sheet drives **both** the bulletin's Singing section and the Monday
reminder text, so the two can never disagree. Publish it to the web as CSV and
set `REMINDER_SHEET_CSV_URL` as a Worker secret.

Headers are read where present — "AM"/"PM" and "Morning"/"Evening" both work.
A cell holding a note rather than names ("Revival", "No evening service") is
printed as written rather than split into people who do not exist.

**The reminder runs Monday from 9am, with Tuesday as a grace day.** Change the
sheet after that and the person swapped out has already been texted while the
person swapped in gets nothing — text them yourself. The bulletin stays correct
either way.

## Scheduled and automatic texts

**Scheduled texts** — write one now, send it later, once or every week, to
everyone, a group, or named individuals.

**Automatic birthday texts** — a switch, a time, and the message. Not a
schedule: a birthday text is a standing arrangement, not something you set up
each year. Off until you turn it on.

Nothing is worked out in advance. A rule is expanded into per-person messages
only when it comes due, so birthdays added to the directory in March are simply
found in March, with nothing to re-create.

**Keep the wording to one segment.** A curly apostrophe or an em dash switches
the encoding and triples what every message costs, forever. Straight quotes and
a hyphen. The app shows you the segment count as you type.

## The members' directory

Members get a personal link by text, valid 30 days and reusable. Each can edit
their own phone, email, address, birthday and anniversary — not their name, and
not their photo, which keeps storage predictable.

**Children are never in the directory.** That rule is enforced at the point of
writing, not merely in the form, so a future change cannot skip it.

Changing a phone number forces a choice about whether the new number should
receive church texts. It is not assumed either way.

## Step 16. The children's ministry section

**Optional, and the largest single thing in here.** If you do not run a
children's ministry with its own volunteers, skip it — nothing else depends on
it. Everything below is off until you give somebody the role in step 16.2.

It exists because children's work has needs the rest of the app does not:
volunteers who must **not** see the congregation's contact details, children
whose families are not members at all, and a register taken on a phone in a
classroom rather than at a desk.

### 16.1 Name it

The code ships with placeholders. Find and replace these across the repo before
anything else, or your volunteers will see square brackets:

| Placeholder | Becomes |
|---|---|
| `Fairhaven Kids` | What you call it — "Lighthouse Kids", "First Kids" |
| `Fairhaven Bucks` | What the play money is called — "Lighthouse Bucks" |

Then drop your own artwork over `app/public/kids-logo-white.png` and
`kids-crown-white.png` (both white-on-transparent, for a dark header) and
`app/public/kids-backdrop.jpg` plus `kids-backdrop-sm.jpg`.

**Do not put a photograph of real children in that backdrop** unless you have
written permission from every family in the frame for that specific use. It is
a public file on a public URL — anyone who guesses the filename can fetch it,
and it ships in your git history forever. A room, a window, or an empty
classroom is a safer picture and looks just as warm.

### 16.2 Who gets in

Two roles, set in `/staff` like any other:

- **`kids`** — a teacher or bus worker. Sees the children's section and *nothing else*
- **`kids-director`** — the same, plus classes, routes, cards, the kiosk and settings

Both can see **every** child, on purpose: a bus driver needs a household's
address, and a teacher covering another class should not be locked out mid-Sunday.
What separates a director is what they can *change*, not what they can see.

**Verify the gate yourself before you let a volunteer near it.** This is the
whole point of the section and it is the one thing a build can get silently
wrong. Sign in as a `kids` volunteer and confirm that `/people`, `/messaging`
and `/staff` all refuse you. Hiding a nav link is not access control; if the
address bar still works, it is not done.

Access is re-checked from the database on **every** request, so switching a
volunteer off locks them out on their next tap — not in a fortnight when their
session lapses. When somebody stops helping, deactivate them the same week.

### 16.3 Classes, routes and children

Set up classes and bus routes first (`/kids/classes`), then add children.

A child needs a name and a class; everything else is optional. **Guardians are
their own records, not directory members** — deliberately, because most
bus-ministry families are not part of the congregation and putting them in
`people` would quietly inflate your attendance figures, your messaging counts
and your directory. If a guardian *is* a member, link them and their contact
details stay in step with the directory instead of going stale.

Allergies get their own field rather than living in the notes, because a
volunteer needs to see it without reading a paragraph.

### 16.4 Cards, if you want them

Each child can carry an NFC card. Tapping it on a signed-in phone opens that
child's page; tapping it at the kiosk checks them in.

- Tags cost roughly 20–50¢. **Buy twice as many as you have children** — they get lost, swapped and taken home
- **Print a QR code on the same card.** It costs nothing, works on every phone, and a dead tag then does not strand a child
- Re-issuing a card **revokes the old one**. Two live cards for one child means two credits, and children work this out quickly

The card holds a random token that means nothing without a signed-in session. A
card found in a car park opens a login screen and no more. That is deliberate —
do not "simplify" it by putting the child's id in the URL.

### 16.5 The kiosk

A tablet by the door that children tap on arrival. It marks the register and
credits them automatically.

Register it from the director's screen. It gets its **own** credential that can
do exactly one thing — check a child in. **Do not sign a tablet in as a member
of staff instead.** A borrowed or stolen tablet would then open every child's
address and allergy notes.

The kiosk shows the child's photo and first name as it scans. That is not
decoration: it is what stops a child tapping a friend's card unnoticed.

If it goes missing, revoke it from your phone.

### 16.6 The play currency

Children earn on arrival and spend on prizes. Every award and spend is its own
record and the balance is their sum, so a disputed total can be looked at, a
mistyped 50 can be undone on its own, and two teachers tapping at once cannot
lose one another's entry.

Set the arrival credit in the app rather than asking anyone to edit code. A
child marked present **by hand** is credited exactly like one who scanned —
forgetting a card is not a punishment.

### 16.7 Texting bus families

**Read this whole section before you switch it on.** It is the only part of the
children's section that spends money and reaches people outside your church.

Sending is a per-person permission, not a role: a director and some bus
captains, not every volunteer. A captain can text **only their own routes**, and
that is enforced on the server — not merely absent from a dropdown.

**The part that matters.** Bus-ministry guardians are not `people` records, so
opting out has to reach them where they actually live. When somebody texts
STOP, the app must record it against the guardian, not only against members.
**Test this before your first real send**: text STOP from a number that belongs
to a guardian and nobody else, then confirm that number is excluded from the
very next send. Do not take it on trust from reading the code.

Getting this wrong is not a bug you notice. The reply is logged, so it looks
handled, and the family simply stops trusting anything the church sends.

Consent being granted already does not change this. Consent can be withdrawn at
any time, and STOP is how a parent does it. Whatever permission you have to text
these families, record when and how you got it.

Replies land in the section's own replies tab, so a parent answering "he's sick
today" reaches somebody. Check it — a reply channel nobody reads is worse than
none, because the parent believes they have told you.

---

---

# Part 4 — Before you launch

Work through this list. Every item is something that has actually gone wrong
somewhere.

- [ ] **Both forms deliver** to the church inbox. Submit them and check.
- [ ] **If you set up the children's section:** signed in as a `kids` volunteer, `/people`, `/messaging` and `/staff` all refuse you (step 16.2).
- [ ] **If you text bus families:** STOP from a guardian-only number excludes them from the next send (step 16.7).
- [ ] **No real children's photographs** committed to the repo (step 16.1).
- [ ] **A text arrives** and its delivery status reaches the app.
- [ ] **Numbers checked** on the Numbers tab — no landlines among people you
      expect to reach.
- [ ] **No children in the directory** — the query in step 13 returns zero.
- [ ] **Sign-in refuses an account you have not added.**
- [ ] **Livestream switches to the player on its own**, and back to the
      countdown afterwards. Manual override switched **off**.
- [ ] **Events show correct dates**, including one crossing a DST boundary.
- [ ] **The CMS saves** and the site rebuilds.
- [ ] **Every page on a phone** — no horizontal scrolling, nothing cut off.
- [ ] **With JavaScript disabled** every page still renders. The motion system
      only ever adds motion; it must never be load-bearing.
- [ ] **No real member data in the repo:**
      ```bash
      git grep -nE "[0-9]{3}-[0-9]{3}-[0-9]{4}|\+1[0-9]{10}" -- . ':!*.lock'
      ```
      Anything that is not a `555` test number or the church's own published
      line should not be there.
- [ ] **The repo is private**, and you have confirmed it — open it in a logged-
      out browser rather than trusting the setting.

## Cloudflare settings that are not in the repo

Two dashboard settings bite silently:

**Caching → Configuration → Browser Cache TTL → "Respect Existing Headers".**
The default is 4 hours and it **rewrites** the cache headers your code sends.
On the original build this defeated the livestream poll: anyone who opened the
page in the four hours before a service watched a countdown through the whole
service, and reloading did not help. Read headers off production, never off
source:

```bash
curl -sID - https://example.org/api/live-status | grep -i cache-control
```

**A rate limit on `/api/sms/run-due`.** That endpoint can spend money and is
public to the middleware, guarded only by a shared secret. Add a WAF rate limit
matching the hostname *and* URI path — putting the hostname in the path field
matches nothing, which looks identical to a rule that is working.

---

# When something is wrong

| Symptom | Almost always |
|---|---|
| Texts fail, error **30034** | 10DLC campaign not approved yet |
| Texts fail, error **30005** | Disconnected number, or a landline |
| Some texts silently missing | A Workers request may make only **50** outbound calls; anything looping over people must batch. This dropped 19, 21 and 24 messages on three broadcasts before it was found |
| Livestream stuck on countdown | Manual override left on, or the browser cached the status — check Browser Cache TTL |
| Livestream shows the wrong video | Override left on from last time |
| CMS login hangs | OAuth worker URL missing from the CSP in `_headers` |
| Birthdays a day early | Never parse `YYYY-MM-DD` with `new Date()` — it is UTC midnight, which is the previous evening in the US |
| Bulletin missing new data | Site built before the app deployed — rebuild the site |
| Cron does nothing after a deploy | `wrangler deploy` wiped a plain var; declare it in the `.toml` |
| A dashboard change had no effect | Worker secrets and vars need a build to promote them |

**The rule underneath most of these:** verifying that something *ran* is not
verifying it is *correct*. Check the thing itself — read the header off
production, query the database, watch a real cron tick — rather than trusting
that a green build means a working feature.

---

# What is deliberately not here

- **No online payments.** Giving is a link to Zeffy. Handling card details
  brings PCI obligations no volunteer should carry.
- **No offline mode.** The site installs to a home screen but does not cache
  for offline use. It was scoped and left out as more moving parts than value.
- **No email sending from the app.** Forms use a relay, precisely to avoid DNS
  authentication records.
- **No member self-registration.** Access is invited, one person at a time.

Each was a decision rather than an omission; `docs/ARCHITECTURE.md` carries the
reasoning if you want to revisit one.

---

# Keeping it running

**Weekly**, about ten minutes: write the bulletin, publish it, check the prayer
list is current.

**Monthly**: look at the People list filtered to "Missing details" and fill a
few gaps. Skim delivery failures on the Messaging page.

**Yearly**: renew the domain. Re-check the Twilio campaign is still registered.

**Almost nothing else.** Sermons import themselves, events come from the
calendar you already keep, birthdays send themselves, and the site rebuilds
nightly. That was the design goal: a site a busy pastor maintains in minutes a
week, not one that becomes a second job.
