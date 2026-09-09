# Migrating a page to the new design

The homepage (`site/src/pages/index.astro`) is the reference implementation.
Every other page follows it. This is the procedure and the traps.

**Status: complete.** All ten pages are on the new system — Home, About,
Ministries, Sermons (archive, series, single), Events, Livestream, Contact
(+ thank-you), Give, Bulletin, Directory. The old token layer has been deleted.

Keep this document: the traps below still apply to any NEW page, and the
verification recipe is the one that caught every bug listed in the log.

---

## Where everything is

| | |
|---|---|
| Approved design | The canvas: https://claude.ai/code/artifact/0008c7a9-3146-4139-a0b3-fe3208ce9476 |
| Design source | `design/body/<Page>.html` — the mockup markup to port |
| Why it looks like this | `design/README.md` — fonts, palette, the photo duotone and its reasoning |
| Photo placement | `design/photos.json` — page → slot → {file, alt} |
| Site photos | `site/src/assets/photos/` (2400px sources; Astro emits WebP variants) |
| Design system | `site/src/styles/tokens.css` + `global.css` |

The mockups in `design/` are **static HTML**. Porting means translating that
markup into an Astro page that pulls real content from `src/content/`.

---

## Procedure

1. Read `design/body/<Page>.html` — that's the agreed layout.
2. Copy `index.astro`'s structure: `BaseLayout`, `<Image>` imports from
   `../assets/photos/`, a scoped `<style>` block.
3. Move the mockup's `<pagestyle>` CSS into the page's `<style>`, dropping
   anything already in `global.css` (`.btn`, `.label`, `.wrap`, `.serif`).
4. Replace mockup placeholders with real content from `src/content/`
   (`settings`, `ministries`, `sermons`). Leave `[bracketed]` text alone —
   it marks facts the pastor still owes.
5. `npm run check && npm run build` — both must be clean.
6. Verify (below), then commit.

---

## Traps that have already cost real time

**Never declare `transform` in a page's scoped `<style>` on a parallax
element.** Astro compiles scoped styles to `.class[data-astro-cid-…]`, which
outranks the global `.par`/`.par-fg` rules — the parallax is computed and then
silently discarded. Let `.par` own the transform; pass the zoom via
`--drift-scale`.

**Use `overflow: clip`, never `overflow: hidden`.** `hidden` makes an element a
scroll container, which breaks `position: sticky` inside it and traps
scroll-linked timelines.

**Parallax sizing.** `data-par` is travel in px on the image, `--drift-scale`
its zoom, and the frame needs `data-par-frame`. The translate is multiplied by
the scale, and the only slack is `(scale-1) × height / 2` per side — overshoot
and the photo's edge slides into frame. But it also has to be big enough to
notice: **aim for the background lagging 15–20% of the scroll distance.** Below
10% it reads as nothing. More lag therefore needs more scale.

**Set `sizes="140vw"` on scaled photos.** srcset picks on layout size, so a
1.35×-rendered image otherwise gets a small variant and looks soft.

**Grades are per-photo.** A grade tuned for one image can bury another — the
homepage's first grade crushed a bright hero to near-black. Weight the grade
where the text sits, keep it light elsewhere, and check against the actual
photo.

**Times are stored 24-hour** so they sort correctly. Use `index.astro`'s
`clockLabel()` to display them, or you'll ship "17:30 pm".

---

## Verifying

The browser preview runs pages with `visibilityState: hidden`, so animation
frames never fire and **screenshots are unreliable**. Don't trust them.

Verify against the **production** build (`npm run build`, then serve `dist/`) —
the scoped-style specificity trap only exists in built output. Then, via
`javascript_tool`:

- `documentElement.scrollWidth > clientWidth` → horizontal scroll (must be false)
- every `img.naturalWidth > 0` → nothing broken
- no rendered text below 11px
- at 390px wide as well as 1440px
- for parallax: replicate the controller's math, set `--py` at several scroll
  offsets, and confirm the photo and copy transforms move in *opposite*
  directions by a meaningful amount

---

## Done: the old token layer is gone

The compatibility aliases (`--ink-black`, `--paper-white`, `--red-accent`,
`--color-accent-tint`) **and** the older `--color-*` semantic layer
(`--color-bg`, `--color-text`, `--color-text-soft`, `--color-accent`,
`--color-accent-hover`, `--color-border`) have been deleted from `tokens.css`.
`global.css` now names the real tokens directly. Nothing in `src/` references
the old names — if you reintroduce one, it will silently resolve to nothing.

---

## Bugs this pass caught, and what to re-check on any new page

Recorded because each one measured "fine" until it was checked the right way.

| Bug | How it was caught |
|---|---|
| Event "More info" href rendered `[object Object]` | Link-checking the built HTML. node-ical returns `{params, val}` for a parameterised property, not a string. |
| That same URL was `messages://open?message-guid=…` | Reading the raw feed. An Apple Messages deep link — useless to a visitor, and it published an internal GUID. `safeEventUrl()` now accepts http/https only. |
| All-day event showed "12:00 AM" | Reading the rendered row. `datetype === 'date'` now sets `allDay`. |
| Bulletin nav invisible | A screenshot. `navTheme` defaults to `dark` (cream links); the Bulletin is the one page that opens on a cream ground. It needs `navTheme="light"`. |
| Give hero was a black rectangle | A screenshot. The mockup's 3-stop grade bottomed out at .28 — the same fault already fixed on Home/About. Weight belongs where the text sits. |
| Sermons empty state said "see docs/README.md" | Scanning visible copy for repo paths. Same for the Contact form notice. Developer instructions belong in HTML comments. |
| Footer heading 3.73:1, copyright 2.87:1 | A contrast sweep over every text node against its real composited background. |
| [Youth Ministry] age chip 4.37:1 | Same sweep. Accents now mix toward cream so the rule holds for the two ministries whose branding isn't set yet. |
| All-day event rendered a day early **on the live site only** | Comparing the deployed page against the local one. node-ical builds an all-day date at LOCAL midnight of the build machine, so Cloudflare's UTC builder produced a different instant than the pastor's Mac; formatting it in the church timezone then fell back across midnight. A calendar date has no timezone and must never be zone-converted. `ical.ts` re-anchors all-day dates to UTC midnight and `eventTimeZone()` picks the zone per event. Regression check: `TZ=UTC npm run build` and `TZ=Asia/Tokyo npm run build` must produce a byte-identical events page. |
| Homepage outline jumped h1 → h3 | Parsing the heading sequence. The section labels were `<p class="label">`; `.label` supplies the whole visual treatment, so promoting them to `<h2>` changed nothing visually. |

**The one that got past every local check:** everything above was caught before
pushing except the all-day date. It could not be — it only appears when the
build machine's timezone differs from the church's, and locally those are the
same. Any date logic must be tested by building under a foreign `TZ`, not just
by reading the local output.

Two measurement traps worth knowing, because both produced convincing false
alarms:

- **`getComputedStyle` can return `color(srgb 0.74 0.82 0.91)`** — components
  are 0–1, not 0–255. A parser that assumes `rgb()` reports near-black and
  invents contrast failures.
- **Naive parallax overflow checks over-report.** Travel exceeding the
  overhang is not automatically visible: a positive `--py` pushes the image
  down, so the bare strip opens at the container's *top*, which by then has
  scrolled off. Simulate an actual scroll and ask whether an uncovered pixel
  is ever inside the viewport. Across every parallax page at four widths,
  none is.
