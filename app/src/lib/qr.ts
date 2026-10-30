import qrcode from 'qrcode-generator';
import type { QrCode } from './lobby.ts';

/**
 * A QR code as one SVG path, drawn on the server so the lobby page carries no
 * QR library of its own — a TV box is not a fast machine.
 *
 * Each row's dark modules are merged into runs, so a code is a few hundred
 * short rectangles rather than a thousand squares. Error correction 'M': the
 * code is read off a television across a foyer, through glare.
 */
export function qrFor(text: string): QrCode {
  // The same handful of links every time, and drawing one is most of the
  // feed's CPU; remembered for as long as this Worker instance lives.
  const hit = drawn.get(text);
  if (hit) return hit;
  if (drawn.size > 50) drawn.clear();
  const code = draw(text);
  drawn.set(text, code);
  return code;
}

const drawn = new Map<string, QrCode>();

function draw(text: string): QrCode {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c)) continue;
      let run = 1;
      while (c + run < n && qr.isDark(r, c + run)) run++;
      d += `M${c} ${r}h${run}v1h-${run}z`;
      c += run - 1;
    }
  }
  return { n, d };
}
