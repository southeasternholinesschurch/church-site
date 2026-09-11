# Sermon transcripts

Why this needs OAuth, what to set up once, and what may refuse to work.

## Why not something simpler

Captions are the one part of a video YouTube will not release for an API key.
Three unofficial routes were tested on 2026-09-11 and all three are closed:

| route | result |
|---|---|
| `/api/timedtext?v=…&lang=en` | HTTP 200, **0 bytes** |
| the `captionTracks` `baseUrl` from the watch page | **0 bytes** |
| `yt-dlp --write-auto-subs` | *"Automatic captions … missing because a PO token was not provided"* |

So the official API as the channel owner is not the awkward option. It is the
only one left.

## Setting it up, once

You already have a Google Cloud project — it holds `YOUTUBE_API_KEY`. Use it.

**1. Create an OAuth client.**
Google Cloud Console → APIs & Services → Credentials → *Create credentials* →
*OAuth client ID* → application type **Desktop app**. Copy the client ID and
client secret.

If it asks you to configure a consent screen first: user type **External**,
fill in the name and your email, and add yourself as a **test user**. It never
needs verifying or publishing, because you are the only person who will ever
use it.

**2. Grant consent once**, signed in as the account that owns the channel:

```bash
cd site
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... node scripts/youtube-auth.mjs
```

It opens a browser, you approve, and it prints a refresh token. That is the
only time this runs.

**3. Store three repo secrets** — Settings → Secrets and variables → Actions:

```
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
```

The refresh token is a password. It grants access to the channel until it is
revoked at https://myaccount.google.com/permissions. It does not expire on its
own, but Google does drop one that has gone unused for six months.

**4. Try it on a single sermon before trusting it with sixty:**

```bash
node scripts/import-transcripts.mjs --dry-run --only 2026-09-06-sunday-morning
```

## The limitation to find out about early

`captions.download` is refused with **403** on auto-generated (ASR) tracks for
some channels. YouTube ties this to whether third-party contributions were ever
enabled on the video, and there is no way to know without asking.

The importer reports this per video rather than failing silently, and says so
plainly at the end of a run.

**If it refuses everything:** opening a video in YouTube Studio, editing the
auto-captions and publishing them converts the track into a real one, which the
API will then hand over. That is per video, so establish whether it is refusing
*all* of them before doing it sixty times by hand.

**If it refuses nothing:** it is fully automatic from here, and the nightly job
picks up each new sermon a day or two after it is preached.

## It works on this channel — tested 2026-09-11

The 403 above did **not** happen here. The API released the auto-generated
track first time, and a full back-catalogue run fetched 33 transcripts with
zero refusals. Two videos have no English captions at all.

### Quota is the real limit, not time

The API allows **10,000 units a day**. Each sermon costs **250**
(`captions.list` 50 + `captions.download` 200), so:

- **40 sermons a day** is the ceiling
- a 60-sermon back-catalogue takes **two nights**
- the script caps itself at **35** by default, leaving units for the sermon
  importer that shares this quota

Blowing the quota does not queue — it returns 403 for *everything else that
day*, including the sermon import. Hence the cap.

## What it writes, and what it is for

Plain text to `site/transcripts/<slug>.txt`. Deliberately **not** a content
collection, so it does not become a page.

**The quality is better than expected.** YouTube's ASR now punctuates and
capitalises, so the text reads as prose rather than as a wall. It still
stumbles on names and repeats itself where speech does.

**Two things to understand before generating anything from these:**

1. **They are whole services, not sermons.** The channel records the full
   service, so a transcript runs 6,000–16,000 words and includes singing,
   announcements and testimony as well as preaching. Anything that turns one
   into an article has to find the message inside it.
2. **Anything generated from a transcript should be read by a person before it
   is published.** It carries a preacher's name, on a church's website. A
   summary that misstates what was preached is worse than no summary at all —
   and a run of sixty unreviewed generated pages is also the exact pattern a
   search engine treats as scaled content abuse, which would defeat the point.
