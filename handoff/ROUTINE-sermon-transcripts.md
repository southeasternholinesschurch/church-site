# Routine: clean up sermon transcripts

Run by a scheduled Claude Code session on the pastor's Mac, Monday and Thursday
mornings. Follow this exactly.

**You are cleaning a transcript, not writing an article.** A previous attempt
produced a 1,000-word summary of a 4,385-word sermon and the pastor rejected it:
*"a bit too compressed… I would like it to be closer to an actual transcript."*
Target **90% or more of the original word count.**

---

## 1. Find the work

```bash
cd "/path/to/your-church-site"
git pull --rebase origin main          # transcripts arrive overnight from CI
ls site/transcripts/*.txt              # raw, from YouTube
ls site/transcripts/drafts/*.md        # already cleaned, awaiting the pastor
```

A sermon needs work when `site/transcripts/<slug>.txt` exists and
`site/transcripts/drafts/<slug>.md` does not, **and** the sermon's markdown body
in `site/src/content/sermons/<slug>.md` is still empty.

**Do at most three per run.** These are long, and a rushed clean is worse than
a late one. Oldest first, so the archive fills in order.

If there is nothing to do, say so in one line and stop. That is a normal
outcome, not a failure.

## 2. Find the sermon inside the service

The recordings are **whole services** — 4,000 to 18,000 words, including
singing, announcements, testimony and the offering. The median is about 9,500.

The message usually opens with something like *"I'd like to direct your
attention to…"* and closes with an appeal and a prayer. Everything before and
after that is not the sermon.

Sanity-check yourself: a sermon is usually **30–70% of the service**. If what
you have cut is 5% or 95%, you have found the wrong boundaries — look again.

Some recordings are almost entirely sermon. That is fine; cut little.

## 3. Clean it

**Remove** — and only these:

- filler: "uh", "um", stammered repeats ("at at", "the the the")
- false starts that the speaker immediately corrects
- bracketed noises the ASR inserted, e.g. `[snorts]`
- lines the ASR duplicated as captions rolled

**Keep** — everything else, in his words and his order:

- every illustration, in full, with its detail. The Washington DC trip, the pocket-dialled phone call, the soldiers at the tomb: these are the sermon, not decoration
- his phrasing, including the repetition he uses deliberately for emphasis
- direct address to the congregation, and his asides to people by name
- the closing prayer

**Fix** what the ASR misheard. It is confident and it is often wrong — and
sometimes the error is doctrinal. Real examples from the first sermon:

| ASR wrote | He said |
|---|---|
| John Christrist | John Chrysostom |
| golden tonged ortor | golden-tongued orator |
| tremoring with rage | screaming with rage |
| **loneliness and meekness** | **lowliness** and meekness (Eph 4:2) |
| pecular people | peculiar people (1 Pet 2:9) |
| My gate is fast | My gait is fast |

**Check every scripture quotation against the text.** He preaches from the KJV.
A misquoted verse published under a pastor's name is the worst thing this
routine can do.

**Format** with:
- paragraphs at natural breaks
- `##` headings that follow his own structure, taken from his own words where possible. Headings are the ONLY thing you add
- `>` block quotes for scripture and for anything he reads aloud
- a bullet list only where he is plainly enumerating

**Do not** summarise, compress, reorder, improve his arguments, or add
transitions he did not say.

## 4. Note anything you changed on purpose

If you correct something he actually said — not an ASR error, but a genuine
slip — put it at the bottom of the draft under `<!-- editor's notes -->`.

Real example: he said "the last four chapters of Ephesians" where Ephesians has
six and he had just said three. Cleaning should fix that, but he must be able to
see that it was fixed.

## 5. Write the draft

To `site/transcripts/drafts/<slug>.md`. **Nothing on the site reads this
directory** — that is deliberate. Nothing publishes without the pastor.

## 6. Commit and report

```bash
git add site/transcripts/drafts
git commit -m "Transcripts: cleaned <slug> (draft, awaiting review)"
git pull --rebase origin main && git push origin main
```

Then tell the pastor, briefly: which sermons were drafted, the word count against the
original, and anything you are unsure about — a passage you could not hear, a
name you guessed at, a scripture you could not place.

**Say what you were unsure about.** Silent confidence is the failure mode here.

## 7. How the pastor publishes one

He reads the draft, edits if he wants, then:

```bash
cd site && node scripts/publish-draft.mjs <slug>
```

That moves the text into the sermon's markdown body, where the page already
renders it, and deletes the draft. Eventually this becomes an Approve button in
the dashboard.

---

## Standing rules

- **Never publish directly.** Drafts only. The review gate is the point.
- **His name is on this.** It is his church's website and his preaching. When a choice is between faithful and polished, choose faithful.
- **Congregant names** ("Brother Harold", "Alan Reeve") currently stay in — the pastor's call, revisit if he changes it.
- Transcripts and drafts are the church's content; do not paste them anywhere outside this repo.
