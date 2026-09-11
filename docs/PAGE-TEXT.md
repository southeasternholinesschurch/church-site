# Page text

Every page's headings, paragraphs and button labels live in
`site/src/content/copy/<page>.yaml`, and are edited in the staff app under
**Website → Page text**. Saving commits the file; the site rebuilds and the new
words are live.

## How a page reads its words

```astro
const t = await copyFor('home');
...
<h1>{t('hero.headline', 'A place to')}</h1>
```

The second argument is the page's own sentence, and it is the whole design.
A key that is missing, misspelt, or deleted by accident shows **that** sentence
rather than a blank heading. So:

- a page works before its copy file exists;
- a bad edit is never worse than an un-edited page;
- you can move one page at a time instead of all of them at once.

An empty string is a deliberate "show nothing" and is respected. Only an absent
key falls back.

## What does NOT belong in these files

Names, service times, the address, phone number, giving links and social links
all come from **Settings**, so one edit fixes them everywhere on the site. A
ministry's description belongs to that ministry, a sermon's write-up to that
sermon, an article of faith to that article. These files hold the frame, never
the contents — if a sentence would be wrong on a second page, it is settings or
content, not page text.

## The check that matters

```
site/scripts/prove-all-copy.sh
```

Every key in every file is replaced with a unique marker, the site is built,
and each marker has to turn up in the HTML. The failure this catches is silent
by construction: a key the page does not read still appears in the dashboard as
a field, takes an edit, commits it, rebuilds the site — and changes nothing.
Nobody has any reason to doubt it.

Keys that only appear in a particular state — an empty calendar, a bulletin
that has not been published — cannot show up in an ordinary build. Those are
listed in `CONDITIONAL` at the top of `scripts/prove-copy.mjs`. **This template
ships empty**, so that list is long: no sermons, no bulletin, no text-message
number. As you add content, delete the entries that start rendering. One still
listed months later is worth a look.

## Still to do

53 sentences across 15 pages are still written into the `.astro` files and are
not yet editable — mostly wrapped paragraphs. They are not broken; they simply
have no key yet. `prove-all-copy.sh` will not mention them, because a sentence
with no key is invisible to it.

To move one: wrap it in `t('some.key', '<the exact sentence>')`, add the key to
that page's YAML, and run the check. Then confirm the built page reads exactly
as it did before — if the words changed, the move was wrong.
