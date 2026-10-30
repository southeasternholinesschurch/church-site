/**
 * The sign-up printout, laid out on the server, page by page.
 *
 * WHY HERE AND NOT IN CSS. The pastor prints from Safari and pins the result on a
 * board, so pages are what matter (2026-10-10/11):
 *   - CSS `columns` printed as ONE column in Safari.
 *   - Keeping every part whole left half-empty columns, so a sheet ran to more
 *     pages than it needed: "a lot of dead space".
 * So the page is packed here like a newspaper. The left column fills to the
 * foot of the page, then the right, then the next page. A part that does not
 * fit carries on in the next column under its heading marked "continued".
 *
 * EVERY HEIGHT IS SET, NOT MEASURED. Each row is printed at exactly the height
 * worked out below (the page writes it as an inline style), and text that
 * would need more lines than allowed is cut off rather than allowed to grow.
 * The estimate of lines is deliberately generous, so in practice nothing is
 * cut; but if it were, the page would still not overflow onto an extra sheet.
 *
 * Pure: no database, no DOM. Tested in test/signups.test.ts.
 */
import type { PrintPart } from './signups.ts';

/* ------------------------------------------------------------- metrics -- */
/* CSS pixels (96 to the inch). print.astro uses these same numbers. */

/*
 * SIZED FOR SAFARI, the smaller of the two. Chrome gives a Letter page 691 ×
 * 950 CSS px inside these margins. Safari prints every CSS pixel about 7%
 * larger (it lays the page out 765px wide for 612pt of paper), which leaves
 * roughly 640 × 884. A page packed for Chrome's numbers spilled a few lines
 * onto an extra sheet in Safari, so the page is packed for Safari's, with a
 * little slack, and Chrome prints the same breaks with a slightly deeper
 * margin at the foot. Measured 2026-10-11 by printing through WebKit and
 * Chrome to PDF.
 */
/** Content height per page, in CSS px. */
export const PAGE_HEIGHT = 868;
/** The text width inside the side margins, as Safari lays it out. */
export const PAGE_WIDTH = 640;
export const COL_GAP = 38;
export const COL_WIDTH = Math.floor((PAGE_WIDTH - COL_GAP) / 2);

export const ROW_LINE = 18;          // one line of an 11pt row
export const ROW_PAD = 8;            // padding and rule around a row
export const ROW_MAX_LINES = 3;
export const BLANK_HEIGHT = 32;      // a line to write on
export const MORE_HEIGHT = 22;
export const HEAD_GAP = 14;          // space above a part, except at the top of a column
export const HEAD_TITLE = 18;        // the part's name
export const HEAD_DETAIL_LINE = 15;
export const HEAD_DETAIL_MAX = 3;      // a job's supplies list can run to three
export const HEAD_COLS = 22;         // the Name / Bringing / Count line
export const RUNNING_HEAD = 30;      // the sheet's name at the top of pages after the first

/** Average glyph widths, on the generous side, so lines are never undercounted. */
const BODY_CHAR = 7.4;               // 11pt Texta
const SMALL_CHAR = 7.4;              // 10pt Texta
const TITLE_CHAR = 19.5;             // 36pt Instrument Serif (a narrow face: ~18 measured)
const INTRO_CHAR = 6.8;

/** The grid of a row: name 1fr, note 1.4fr, an optional 48px count, 12px gaps. */
export function rowColumns(heads: boolean): { name: number; note: number } {
  const room = COL_WIDTH - 12 - (heads ? 48 + 12 : 0);
  return { name: Math.floor(room / 2.4), note: Math.floor((room / 2.4) * 1.4) };
}

export const linesFor = (text: string | null | undefined, px: number, charPx: number): number => {
  const t = (text ?? '').trim();
  if (!t) return 1;
  const perLine = Math.max(1, Math.floor(px / charPx));
  // Words wrap whole, so a line holds a little less than its width in letters.
  let lines = 1, used = 0;
  for (const word of t.split(/\s+/)) {
    let w = word.length;
    const need = used === 0 ? w : used + 1 + w;
    if (need <= perLine) { used = need; continue; }
    if (used > 0) { lines++; used = 0; }
    while (w > perLine) { lines++; w -= perLine; }   // a word too long for a line
    used = w;
  }
  return lines;
};

/* ----------------------------------------------------------- the header -- */

export const TITLE_MAX = 2;
export const INTRO_MAX = 4;

export interface Header { height: number; titleLines: number; introLines: number }

/**
 * The top of the first page: the church and the date printed, the title, the
 * date of the event, the intro, and one line saying how to use the sheet (or,
 * on a closed sheet, that the list is final).
 */
export function headerFor(o: { title: string; when: boolean; intro: string | null }): Header {
  const titleLines = Math.min(TITLE_MAX, linesFor(o.title, PAGE_WIDTH, TITLE_CHAR));
  const introLines = o.intro ? Math.min(INTRO_MAX, linesFor(o.intro, PAGE_WIDTH, INTRO_CHAR)) : 0;
  const height =
    22                                  // the kicker line, and the date it was printed
    + titleLines * 46 + 6               // the title
    + (o.when ? 30 : 0)
    + introLines * 20 + (introLines ? 8 : 0)
    + 26                                // "write your name on an open line"
    + 14;                               // space before the parts
  return { height, titleLines, introLines };
}

/* ------------------------------------------------------------ the items -- */

export type PrintItem =
  | { t: 'head'; label: string | null; detail: string | null; detailLines: number; cont: boolean; gap: boolean; h: number }
  | { t: 'row'; name: string; note: string | null; headcount: number | null; lines: number; h: number }
  | { t: 'blank'; h: number }
  | { t: 'more'; n: number; h: number }
  | { t: 'empty'; h: number };

export interface PrintPage { cols: [PrintItem[], PrintItem[]] }

function headItem(p: PrintPart, showLabel: boolean, cont: boolean, gap: boolean): PrintItem {
  const detail = showLabel && !cont ? p.detail : null;
  const detailLines = detail ? Math.min(HEAD_DETAIL_MAX, linesFor(detail, COL_WIDTH, SMALL_CHAR)) : 0;
  const h = (gap ? HEAD_GAP : 0) + (showLabel ? HEAD_TITLE : 0) + detailLines * HEAD_DETAIL_LINE + HEAD_COLS;
  return { t: 'head', label: showLabel ? p.label : null, detail, detailLines, cont, gap, h };
}

function bodyItems(p: PrintPart, heads: boolean): PrintItem[] {
  const w = rowColumns(heads);
  const rows: PrintItem[] = p.filled.map((f) => {
    const lines = Math.min(ROW_MAX_LINES, Math.max(
      linesFor(f.name, w.name, BODY_CHAR), linesFor(f.note, w.note, BODY_CHAR)));
    return { t: 'row', name: f.name, note: f.note, headcount: f.headcount, lines, h: ROW_PAD + lines * ROW_LINE };
  });
  for (let i = 0; i < p.blanks; i++) rows.push({ t: 'blank', h: BLANK_HEIGHT });
  if (p.more > 0) rows.push({ t: 'more', n: p.more, h: MORE_HEIGHT });
  // A closed sheet's part that nobody took: say so rather than print nothing.
  if (!rows.length) rows.push({ t: 'empty', h: MORE_HEIGHT });
  return rows;
}

/**
 * Pack the parts into pages of two columns.
 *
 * Three rules keep it short AND readable:
 *   - Every column fills to the foot of the page before the next one starts,
 *     so no page is printed half empty while there is more to come.
 *   - A heading never sits alone at the foot of a column: it moves on unless
 *     it can take at least two of its lines with it (or all, if it has fewer).
 *     A part that carries on repeats its heading, marked continued.
 *   - The LAST page is shared evenly between its two columns, so a short sheet
 *     is two half-columns side by side rather than one long one and a blank.
 *     This never adds a page: it only lowers how far down the last page goes.
 */
export function packPrint(
  parts: PrintPart[],
  o: { firstPage: number; heads: boolean; showLabels: boolean },
): PrintPage[] {
  const normal = (i: number) => (i < 2 ? o.firstPage : PAGE_HEIGHT - RUNNING_HEAD);
  const base = pack(parts, o, normal);
  const pages = Math.max(1, Math.ceil(base.length / 2));
  const last = 2 * (pages - 1);

  // The shortest last-page column that still fits everything on `pages` pages.
  let lo = 1, hi = normal(last), best = base;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const cols = pack(parts, o, (i) => (i >= last ? mid : normal(i)));
    if (cols.length <= 2 * pages) { hi = mid; best = cols; } else lo = mid + 1;
  }
  if (hi !== normal(last)) best = pack(parts, o, (i) => (i >= last ? hi : normal(i)));

  const out: PrintPage[] = [];
  for (let i = 0; i < Math.max(best.length, 1); i += 2) out.push({ cols: [best[i] ?? [], best[i + 1] ?? []] });
  return out;
}

/** Fill columns in order, each to `capOf(its index)`. */
function pack(
  parts: PrintPart[],
  o: { heads: boolean; showLabels: boolean },
  capOf: (col: number) => number,
): PrintItem[][] {
  const cols: PrintItem[][] = [];
  let cur: PrintItem[] = [];
  let used = 0;
  const cap = () => capOf(cols.length);
  const nextCol = () => { cols.push(cur); cur = []; used = 0; };
  const put = (it: PrintItem) => { cur.push(it); used += it.h; };

  for (const p of parts) {
    const body = bodyItems(p, o.heads);
    const keep = body.slice(0, 2).reduce((n, it) => n + it.h, 0);
    if (used > 0 && used + headItem(p, o.showLabels, false, true).h + keep > cap()) nextCol();
    put(headItem(p, o.showLabels, false, used > 0));

    for (const it of body) {
      // An empty column always takes at least one line, whatever its height,
      // so a column too short for anything cannot loop forever.
      if (used + it.h > cap() && cur.some((x) => x.t !== 'head')) {
        nextCol();
        put(headItem(p, o.showLabels, true, false));
      }
      put(it);
    }
  }
  if (cur.length) cols.push(cur);
  return cols;
}
