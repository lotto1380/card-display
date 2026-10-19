// Renders the app icons (192 and 512) with headless Chromium. Run: node test/make-icons.mjs
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(here, '..', 'icons');
await mkdir(iconsDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [192, 512]) {
  const dataUrl = await page.evaluate((size) => {
    const c = document.createElement('canvas'); c.width = size; c.height = size;
    const g = c.getContext('2d');
    const u = size / 64;
    g.fillStyle = '#15171A'; g.fillRect(0, 0, size, size);
    // A portrait card with the four-color stripe: the output contract as the mark.
    const x = 18 * u, y = 10 * u, w = 28 * u, h = 44 * u, r = 3 * u;
    g.fillStyle = '#F1F2EE';
    g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    const bands = ['#000000', '#FF0000', '#FFFF00', '#FFFFFF'];
    const bh = 5 * u;
    bands.forEach((col, i) => { g.fillStyle = col; g.fillRect(x + 4 * u, y + 5 * u + i * (bh + 1.5 * u), w - 8 * u, bh); });
    g.fillStyle = '#15171A';
    g.fillRect(x + 4 * u, y + 34 * u, w - 8 * u, 2 * u);
    g.fillRect(x + 4 * u, y + 38 * u, (w - 8 * u) * 0.7, 2 * u);
    return c.toDataURL('image/png');
  }, size);
  await writeFile(resolve(iconsDir, `icon-${size}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log(`wrote icons/icon-${size}.png`);
}
await browser.close();
