/**
 * Turns the hand-made exercise illustrations in photos-in/ into the web-sized
 * WebP files the app ships, in public/exercise-photos/.
 *
 * The sources are ~1.2 MB PNGs around 1500px; the detail sheet shows two of
 * them side by side in a column about 190 CSS px wide, so anything past ~640px
 * on the long edge is bytes the phone downloads and throws away.
 *
 * Run once when the artwork changes:
 *   npm i --no-save puppeteer-core
 *   node scripts/photos-optimise.mjs
 *
 * Chrome does the encoding rather than an image library, for the same reason
 * make-icons.mjs draws PNGs by hand: this repo has no build-time binary
 * dependency, and a one-off conversion should not add one. Only the outputs
 * are committed.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const IN = join(here, '..', 'photos-in');
const OUT = join(here, '..', 'public', 'exercise-photos');
/** Long edge in CSS pixels × a bit, so it still looks right on a 3× screen. */
const MAX_EDGE = 640;
const QUALITY = 0.82;

const require = createRequire(join(here, '..', 'package.json'));
let puppeteer;
try {
  puppeteer = require('puppeteer-core');
} catch {
  console.error('puppeteer-core is not installed. Run: npm i --no-save puppeteer-core');
  process.exit(1);
}

const CHROME =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

if (!existsSync(IN)) {
  console.error(`no ${IN} — put the source illustrations there first`);
  process.exit(1);
}

const sources = readdirSync(IN).filter((name) => /\.(png|jpe?g)$/i.test(name)).sort();
if (sources.length === 0) {
  console.error('nothing to convert');
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox'],
});
const page = await browser.newPage();

let total = 0;
for (const name of sources) {
  const raw = readFileSync(join(IN, name));
  const mime = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg';
  const webp = await page.evaluate(
    async ({ dataUrl, maxEdge, quality }) => {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = reject;
        image.src = dataUrl;
      });
      const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d');
      /* White, not transparent: the illustrations are cut out on white, and a
         transparent WebP goes muddy on the dark theme's surface. */
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/webp', quality);
    },
    { dataUrl: `data:${mime};base64,${raw.toString('base64')}`, maxEdge: MAX_EDGE, quality: QUALITY },
  );

  const out = name.replace(/\.(png|jpe?g)$/i, '.webp');
  const bytes = Buffer.from(webp.split(',')[1], 'base64');
  writeFileSync(join(OUT, out), bytes);
  total += bytes.length;
  console.log(
    `${out.padEnd(32)} ${(raw.length / 1024).toFixed(0).padStart(5)} KB -> ${(bytes.length / 1024).toFixed(0).padStart(4)} KB`,
  );
}

await browser.close();
console.log(`\n${sources.length} files, ${(total / 1024).toFixed(0)} KB total`);
