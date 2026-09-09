// Runs automatically before every build (see package.json's "prebuild"
// script — npm's built-in pre-hook convention, no extra CI config needed).
//
// Decap CMS media uploads land raw in public/uploads/ — straight off
// someone's phone, often 10+ MB. Since public/ bypasses Astro's
// astro:assets image pipeline entirely (only src/ gets optimized), this
// script is the safety net: it resizes/re-compresses anything oversized
// IN PLACE in public/uploads/ itself, before astro build copies it into
// dist/. Locally that means it rewrites the actual tracked file — which
// is fine (good, even): committing the shrunk version keeps the repo
// small too. On Cloudflare's CI it runs against that build's fresh
// checkout, same effect, nothing to commit there. Either way it's
// idempotent — re-running on an already-optimized file just re-confirms
// it's already small (the `buffer.length < beforeBytes` check skips the
// write when there's nothing to gain), no repeated quality loss.
import sharp from 'sharp';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uploadsDir = join(__dirname, '../public/uploads');

const MAX_WIDTH = 2000;
const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

let files;
try {
  files = readdirSync(uploadsDir);
} catch {
  process.exit(0); // no uploads folder yet — nothing to do
}

for (const file of files) {
  const ext = extname(file).toLowerCase();
  if (!RASTER_EXT.has(ext)) continue;

  const path = join(uploadsDir, file);
  const beforeBytes = statSync(path).size;

  const img = sharp(path);
  const meta = await img.metadata();
  const needsResize = (meta.width ?? 0) > MAX_WIDTH;

  let pipeline = needsResize ? img.resize({ width: MAX_WIDTH }) : img;
  if (ext === '.jpg' || ext === '.jpeg') pipeline = pipeline.jpeg({ quality: 80, mozjpeg: true });
  else if (ext === '.png') pipeline = pipeline.png({ compressionLevel: 9 });
  else if (ext === '.webp') pipeline = pipeline.webp({ quality: 80 });

  const buffer = await pipeline.toBuffer();
  if (buffer.length < beforeBytes) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(path, buffer);
    console.log(`optimize-uploads: ${file} ${(beforeBytes / 1024 / 1024).toFixed(1)}MB -> ${(buffer.length / 1024 / 1024).toFixed(1)}MB`);
  }
}
