# Church website + members' app — template

A complete website and private staff app for a small church, built to be run by
a volunteer rather than a developer.

**Start with [`SETUP.md`](SETUP.md).** It takes you from an empty Cloudflare
account to a live site, and is written to be followed by a busy pastor or by an
AI agent working on their behalf.

---

## What is here

```
site/       the public website        — Astro, static, Cloudflare Workers
app/        the staff + members app   — Astro SSR, D1 database, R2 photos
workers/    three small cron Workers  — site rebuild, texting, CMS OAuth proxy
docs/       architecture and history
```

**The public site** — Home, About, Ministries, Sermons, Events, Livestream,
Contact, Give, Bulletin. Sermons import themselves nightly from YouTube. Events
come from a calendar you already keep. The livestream page knows when you are
live.

**The staff app** — people, attendance, groups, trends, a bulletin editor,
texting (broadcasts, replies, scheduled, automatic birthdays), and a members'
directory reached by a personal link.

**A children's ministry section** — optional, and off until you switch it on.
Volunteers who see the children and nothing else in the app, class registers
taken on a phone, children and guardians for bus-ministry families who are not
members, NFC cards, a check-in kiosk, a play currency, and texting to individual
bus routes. See `SETUP.md` step 16, which is worth reading before you decide
whether you want it.

## Four design directions

Pick one; it restyles the whole site from a single line. Each is a palette, a
type pairing and a corner treatment that hold together, and every text/background
pair has been checked against WCAG AA.

| | Suits |
|---|---|
| **Sanctuary** — warm, editorial, timeless | established, traditional |
| **Open** — airy, contemporary, unfussy | contemporary, young families |
| **Heritage** — formal, classical | historic, liturgical |
| **Plain** — bold, minimal | church plant, younger congregation |

Previews: `docs/theme-sanctuary.png` · `docs/theme-open.png` ·
`docs/theme-heritage.png` · `docs/theme-plain.png`

## Running costs

Free, except texting — a few dollars a month for a church of about 150. See
SETUP.md for the breakdown.

## Before you publish anything

**Photographs of people need consent, and a child's needs a parent's.** This is
the part of a church website most likely to cause hurt, and it is not a
technical problem.

**Member data never belongs in this repo.** Names, addresses, birthdates and
phone numbers live in the database. Keep exports out of the project folder
entirely, and keep the repo private.

## Origin

Built for one church over several weeks, then generalised. `docs/ARCHITECTURE.md`
is the original build log — every stack decision with its reasoning, and every
trap that cost real time. When SETUP.md says "and here is why", that is where
it is.

Photographs, logos, sermon archive, staff profiles and member data from the
original church have all been removed. Placeholders are marked `[like this]`;
SETUP.md has a command to find every one still outstanding.
