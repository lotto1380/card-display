// End-to-end verification of the Card Display web app in headless Chromium.
// Serves ./web over local HTTP (the OCR worker and service worker need http),
// then checks the output contract, storage, OCR parse, live OCR, and the UI flow.
//
//   cd web && npm install && npm test
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const outDir = resolve(here, 'out');
await mkdir(outDir, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.gz': 'application/gzip', '.wasm': 'application/wasm' };
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = join(root, path);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    const s = await stat(file);
    if (!s.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream', 'content-length': s.size });
    res.end(await readFile(file));
  } catch (e) { res.writeHead(404); res.end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 800 }, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_TUNNEL|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
await page.goto(base);
await page.waitForFunction(() => window.__cardDisplay);
await page.waitForTimeout(300);

const failures = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures.push(name); };

const core = await page.evaluate(async () => {
  const cd = window.__cardDisplay;
  const set = new Set(cd.PALETTE.map(c => c.join(',')));
  const inPalette = d => { for (let p = 0; p < d.length; p += 4) if (!set.has(`${d[p]},${d[p + 1]},${d[p + 2]}`) || d[p + 3] !== 255) return false; return true; };
  const colors = d => { const s = new Set(); for (let p = 0; p < d.length; p += 4) s.add(`${d[p]},${d[p + 1]},${d[p + 2]}`); return s.size; };
  const data = c => c.getContext('2d').getImageData(0, 0, c.width, c.height).data;

  const photo = document.createElement('canvas'); photo.width = 1200; photo.height = 1600;
  const g = photo.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 1200, 1600); grad.addColorStop(0, '#f3e9c8'); grad.addColorStop(1, '#2b1d0e');
  g.fillStyle = grad; g.fillRect(0, 0, 1200, 1600);
  g.fillStyle = '#c62828'; g.fillRect(100, 100, 400, 300);
  g.fillStyle = '#ffd600'; g.fillRect(700, 900, 350, 450);
  const dithered = cd.preparePhoto(photo);
  const wide = document.createElement('canvas'); wide.width = 1600; wide.height = 1200;
  wide.getContext('2d').fillStyle = '#888'; wide.getContext('2d').fillRect(0, 0, 1600, 1200);
  const wideOut = cd.preparePhoto(wide);
  const text = cd.buildTextCard({ title: 'Copied Card With A Long Title That Needs Ellipsis', typeLine: 'Creature — Test Shapeshifter', rulesText: 'This is editable game text.\n\nIt wraps across lines.', sourceCardName: 'Copy Source' });
  const white = document.createElement('canvas'); white.width = 800; white.height = 1000;
  white.getContext('2d').fillStyle = '#fff'; white.getContext('2d').fillRect(0, 0, 800, 1000);

  const parsed = cd.parseOcrText('Ember Courier\nCreature — Goblin Scout\nHaste\nWhenever Ember Courier attacks, draw a card.\n2/2\nIllus. Someone\n© 2026 Publisher');

  const bytes = await new Promise(r => text.toBlob(b => b.arrayBuffer().then(r), 'image/png'));
  const rec = await cd.repo.save({ game: 'mtg', name: 'Round Trip', typeLine: 'Artifact', rulesText: 'Tap: test.', pngBytes: bytes });
  const back = await cd.repo.imageBytes(rec);
  const saved = (await cd.repo.all('mtg')).length;
  await cd.repo.saveCorrection('mtg', 'Round Trip', { name: 'Round Trip', typeLine: 'Artifact', rulesText: 'Tap: test.' });
  const correction = await cd.repo.correctionFor('mtg', '  round   trip ');
  await cd.repo.remove(rec.id);
  const afterDelete = (await cd.repo.all('mtg')).length;

  return {
    photo: { w: dithered.width, h: dithered.height, palette: inPalette(data(dithered)), colors: colors(data(dithered)) },
    wide: { w: wideOut.width, h: wideOut.height, palette: inPalette(data(wideOut)) },
    text: { w: text.width, h: text.height, palette: inPalette(data(text)), colors: colors(data(text)) },
    inspectWhite: cd.inspectImage(white).warnings.length,
    parsed,
    storage: { mode: cd.store.mode, saved, sameLength: back.byteLength === bytes.byteLength, header: Array.from(new Uint8Array(back).slice(0, 4)), afterDelete, correctionOk: !!correction && correction.typeLine === 'Artifact' },
  };
});

check('photo output is 300×400', core.photo.w === 300 && core.photo.h === 400);
check('photo output is palette-only', core.photo.palette, `${core.photo.colors} colors`);
check('landscape source crops to 300×400 palette-only', core.wide.w === 300 && core.wide.h === 400 && core.wide.palette);
check('text card is 300×400 palette-only', core.text.w === 300 && core.text.h === 400 && core.text.palette, `${core.text.colors} colors`);
check('flat white photo raises glare + blur warnings', core.inspectWhite === 2);
check('OCR parse: name', core.parsed.name === 'Ember Courier');
check('OCR parse: type line', core.parsed.typeLine === 'Creature — Goblin Scout');
check('OCR parse: rules drop P/T, illus., ©', core.parsed.rulesText === 'Haste\nWhenever Ember Courier attacks, draw a card.', JSON.stringify(core.parsed.rulesText));
check('storage encrypted', core.storage.mode === 'encrypted', core.storage.mode);
check('storage round trip', core.storage.saved === 1 && core.storage.sameLength && core.storage.header.join(',') === '137,80,78,71' && core.storage.afterDelete === 0);
check('correction lookup normalizes names', core.storage.correctionOk);

// Live OCR with the vendored Tesseract files on a rendered card-like image.
const ocrResult = await page.evaluate(async () => {
  const cd = window.__cardDisplay;
  const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
  const g = c.getContext('2d');
  g.fillStyle = '#f4efe2'; g.fillRect(0, 0, 900, 1200);
  g.fillStyle = '#000';
  g.font = 'bold 52px Arial'; g.fillText('Ember Courier', 60, 110);
  g.fillStyle = '#9a8f78'; g.fillRect(60, 160, 780, 520);
  g.fillStyle = '#000';
  g.font = '40px Arial'; g.fillText('Creature - Goblin Scout', 60, 760);
  g.font = '36px Arial'; g.fillText('Haste', 60, 850);
  g.fillText('Whenever Ember Courier attacks,', 60, 910);
  g.fillText('reveal the top card.', 60, 960);
  g.font = 'bold 40px Arial'; g.fillText('2/2', 760, 1140);
  const started = Date.now();
  try {
    const parsed = await cd.ocr.read(cd.prepareForOcr(c));
    return { ok: true, ms: Date.now() - started, parsed, state: cd.ocr.state };
  } catch (e) { return { ok: false, error: String(e && e.message || e), state: cd.ocr.state }; }
});
check('live OCR runs from vendored files', ocrResult.ok, ocrResult.ok ? `${ocrResult.ms} ms` : ocrResult.error);
if (ocrResult.ok) {
  check('live OCR finds the card name', /ember courier/i.test(ocrResult.parsed.name), JSON.stringify(ocrResult.parsed.name));
  check('live OCR finds the type line', /creature/i.test(ocrResult.parsed.typeLine), JSON.stringify(ocrResult.parsed.typeLine));
  check('live OCR drops the P/T line', !/2\s*\/\s*2/.test(ocrResult.parsed.rulesText), JSON.stringify(ocrResult.parsed.rulesText));
}

// UI flow: MTG → scan → camera screen (no camera in headless) → choose a photo → review → confirm → final → library.
await page.click('[data-game="mtg"]');
await page.waitForSelector('#screen-library:not([hidden])');
const photoPng = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
  const g = c.getContext('2d'); g.fillStyle = '#e0d6b8'; g.fillRect(0, 0, 900, 1200);
  g.fillStyle = '#b71c1c'; g.fillRect(60, 60, 780, 500); g.fillStyle = '#000'; g.font = 'bold 60px Arial'; g.fillText('Elf Warrior', 80, 700);
  g.font = '34px Arial'; g.fillText('Creature - Elf Warrior', 80, 800);
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
});
const photoPath = resolve(outDir, 'photo.png');
await writeFile(photoPath, Buffer.from(photoPng));
await page.click('#btn-scan');
await page.waitForSelector('#sheet:not([hidden])');
await page.click('#btn-sheet-continue');
await page.waitForSelector('#screen-camera:not([hidden])');
await page.setInputFiles('#file-library', photoPath);
await page.waitForSelector('#screen-review:not([hidden])', { timeout: 15000 });
await page.waitForFunction(() => /Text read|No text|not available/.test(document.getElementById('ocr-label').textContent), null, { timeout: 60000 });
const reviewState = await page.evaluate(() => ({ name: document.getElementById('f-name').value, type: document.getElementById('f-type').value, label: document.getElementById('ocr-label').textContent }));
check('review screen OCR prefilled the name', /elf warrior/i.test(reviewState.name), JSON.stringify(reviewState));
await page.screenshot({ path: resolve(outDir, 'review.png'), fullPage: true });
await page.fill('#f-name', 'Elf Warrior');
await page.click('#btn-confirm');
await page.waitForSelector('#screen-final:not([hidden])', { timeout: 10000 });
const finalState = await page.evaluate(() => ({ title: document.getElementById('title').textContent, shareHidden: document.getElementById('btn-share').hidden, img: document.getElementById('final-img').src.slice(0, 14) }));
check('final screen shows the saved card', finalState.title === 'Elf Warrior' && finalState.img === 'data:image/png');
await page.screenshot({ path: resolve(outDir, 'final.png'), fullPage: true });
await page.click('#btn-final-back');
await page.waitForSelector('#screen-library:not([hidden])');
await page.waitForTimeout(300);
check('library lists the saved card', (await page.locator('#list .row').count()) === 1);
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
check('no horizontal overflow at 400px', !overflow);
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
