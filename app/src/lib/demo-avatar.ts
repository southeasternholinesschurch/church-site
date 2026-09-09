/**
 * Illustrated portraits for the public demo.
 *
 * Generated from the person's id, so they are stable, unique-feeling and cost
 * nothing to store — the demo Worker has no R2 bucket and does not need one.
 *
 * ILLUSTRATED, not photorealistic, and deliberately. Photorealistic faces of
 * people who do not exist, presented as a congregation, is a small dishonesty
 * that a church product should not open with — and the moment a visitor
 * recognises one as AI-generated, everything else on the page is in question.
 * A drawn portrait is obviously a drawing, reads as design rather than as a
 * claim, and does the real job: showing that the directory has faces in it.
 */

/** Warm, mid-tone, and legible against the directory's cream cards. */
const SKIN = ['#f0c9a8', '#e0ac84', '#c68f68', '#a3714f', '#7d5335', '#5b3c26'];
const HAIR = ['#2b2118', '#4a3527', '#6b4a2f', '#8a6237', '#b08d5b', '#9a9a95', '#d8d3cb'];
const CLOTH = ['#3c4f6b', '#6b3c3c', '#3c6b52', '#5a4a6b', '#6b5a3c', '#41566b', '#6b4658', '#4a5b3c'];
const BACK = ['#eae2d6', '#e6ddd0', '#e9e3d8', '#e4dccf'];

function h(id: number, salt: number): number {
  let x = (id * 2654435761 + salt * 97711) >>> 0;
  x ^= x >>> 13;
  return x >>> 0;
}
const pick = <T,>(a: T[], id: number, salt: number): T => a[h(id, salt) % a.length];

/**
 * One portrait, as an SVG string.
 *
 * Built from a small set of parts — hair, facial hair, glasses — so a grid of
 * eighty reads as eighty different people rather than one face repeated. The
 * combinations run to several thousand, which is plenty for a demo of 127.
 */
export function demoAvatarSvg(id: number, size = 256): string {
  const skin = pick(SKIN, id, 1);
  const hair = pick(HAIR, id, 2);
  const cloth = pick(CLOTH, id, 3);
  const back = pick(BACK, id, 4);
  const style = h(id, 5) % 6;          // hair shape
  const beard = h(id, 6) % 5 === 0;    // one in five
  const glasses = h(id, 7) % 4 === 0;  // one in four
  const smile = 6 + (h(id, 8) % 5);    // how much of a smile

  const hairShape = [
    // 0 short crop
    `<path d="M78 108c0-30 22-52 50-52s50 22 50 52c0 6-2 10-4 12-4-22-22-34-46-34s-42 12-46 34c-2-2-4-6-4-12z" fill="${hair}"/>`,
    // 1 side part
    `<path d="M76 110c2-32 24-54 52-54 26 0 46 16 52 40-16-10-40-16-64-10-16 4-30 12-40 24z" fill="${hair}"/>`,
    // 2 long, past the shoulders
    `<path d="M74 112c0-34 24-56 54-56s54 22 54 56c0 24-4 46-8 60l-14 4c6-20 8-40 6-56-4-24-20-36-38-36s-34 12-38 36c-2 16 0 36 6 56l-14-4c-4-14-8-36-8-60z" fill="${hair}"/>`,
    // 3 bun
    `<circle cx="128" cy="48" r="16" fill="${hair}"/><path d="M78 108c0-30 22-52 50-52s50 22 50 52c0 6-2 10-4 12-4-22-22-34-46-34s-42 12-46 34c-2-2-4-6-4-12z" fill="${hair}"/>`,
    // 4 curls
    `<g fill="${hair}"><circle cx="94" cy="88" r="18"/><circle cx="118" cy="74" r="20"/><circle cx="146" cy="78" r="19"/><circle cx="166" cy="96" r="17"/><circle cx="82" cy="110" r="14"/><circle cx="176" cy="114" r="14"/></g>`,
    // 5 receding
    `<path d="M84 106c6-22 22-36 44-36 20 0 36 10 44 28-14-8-30-10-44-8-18 2-34 8-44 16z" fill="${hair}"/>`,
  ][style];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}" role="img" aria-label="Illustrated portrait">
  <rect width="256" height="256" fill="${back}"/>
  <path d="M42 256c0-44 38-70 86-70s86 26 86 70z" fill="${cloth}"/>
  <path d="M108 168h40v34a20 20 0 0 1-40 0z" fill="${skin}"/>
  <ellipse cx="128" cy="120" rx="50" ry="58" fill="${skin}"/>
  ${beard ? `<path d="M80 124c0 40 22 62 48 62s48-22 48-62c-6 34-24 46-48 46s-42-12-48-46z" fill="${hair}" opacity=".92"/>` : ''}
  ${hairShape}
  <circle cx="110" cy="118" r="5" fill="#2b2118"/>
  <circle cx="146" cy="118" r="5" fill="#2b2118"/>
  <path d="M114 ${142 + smile}q14 10 28 0" stroke="#8a5a44" stroke-width="4" fill="none" stroke-linecap="round"/>
  ${glasses ? `<g stroke="#3a3128" stroke-width="4" fill="none"><circle cx="110" cy="118" r="15"/><circle cx="146" cy="118" r="15"/><path d="M125 118h6M95 116l-12-4M161 116l12-4"/></g>` : ''}
</svg>`;
}
