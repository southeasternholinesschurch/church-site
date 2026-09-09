// Rasterizes the real SHC logo mark (src/assets/brand/church-mark.png) into
// every PWA/favicon size the manifest and <head> expect. Re-run this
// (`node scripts/generate-icons.mjs`) any time that source file changes.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(__dirname, '../src/assets/brand/church-mark.png');
const iconsDir = join(__dirname, '../public/icons');
const publicDir = join(__dirname, '../public');
mkdirSync(iconsDir, { recursive: true });

// Standard (non-maskable) icons — the mark can fill the whole canvas.
for (const size of [192, 512]) {
  await sharp(sourcePath)
    .resize(size, size)
    .png()
    .toFile(join(iconsDir, `icon-${size}.png`));
  console.log(`wrote icons/icon-${size}.png`);
}

// Maskable variant (Android adaptive icons): the OS can crop this into a
// circle/squircle/etc, so the mark needs real safe-zone padding — scale it
// down onto a padded canvas rather than reusing the tight crop above.
const maskableSize = 512;
const markSize = Math.round(maskableSize * 0.7); // ~15% padding each side
const markBuffer = await sharp(sourcePath).resize(markSize, markSize).png().toBuffer();
await sharp({
  create: { width: maskableSize, height: maskableSize, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
})
  .composite([{ input: markBuffer, gravity: 'center' }])
  .png()
  .toFile(join(iconsDir, 'icon-512-maskable.png'));
console.log('wrote icons/icon-512-maskable.png');

// Browser-tab favicon (crisp small size, referenced directly from <head>).
await sharp(sourcePath).resize(48, 48).png().toFile(join(publicDir, 'favicon-48.png'));
console.log('wrote favicon-48.png');
