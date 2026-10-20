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
  const text = cd.buildTextCard({ title: 'Copied Card With A Long Title That Needs Ellipsis', typeLine: 'Creature — Test Shapeshifter', rulesText: 'This is editable game text.\n\nIt wraps across lines.', sourceCardName: 'Copy Source', pt: '3/3' });
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
check('OCR parse: P/T kept as pt', core.parsed.pt === '2/2', JSON.stringify(core.parsed.pt));
check('storage encrypted', core.storage.mode === 'encrypted', core.storage.mode);
check('storage round trip', core.storage.saved === 1 && core.storage.sameLength && core.storage.header.join(',') === '137,80,78,71' && core.storage.afterDelete === 0);
check('correction lookup normalizes names', core.storage.correctionOk);

// Copy merge: each except-clause pattern on its own, then whole-card fixtures.
// Every name and line of rules text here is invented.
const merge = await page.evaluate(() => {
  const cd = window.__cardDisplay, P = cd.copyPatterns;
  const run = (key, clause, target) => { const d = cd.mergeDraft(target); const rest = P[key](clause, d); return { ...d, rest: rest.replace(/\0/g, '') }; };
  const courier = { name: 'Ember Courier', typeLine: 'Creature — Goblin Scout', rulesText: 'Haste\nWhenever Ember Courier attacks, draw a card.', pt: '2/2' };
  const elder = { name: 'Thornwood Elder', typeLine: 'Legendary Creature — Elf Druid', rulesText: 'Reach', pt: '1/3' };
  const beacon = { name: 'Brass Beacon', typeLine: 'Artifact', rulesText: 'Tap: Scry 1.', pt: '' };
  const copier = (name, rulesText) => ({ name, typeLine: 'Creature — Shapeshifter', rulesText, pt: '0/0' });
  return {
    patterns: {
      quoted: run('quoted', `it has 'Draw a card.' and "Gain 1 life."`, courier).abilities,
      name: run('name', 'with the name Quiet Echo', courier).name,
      cardType: run('cardType', "it's an artifact in addition to its other types", { typeLine: 'Creature — Golem' }).typeLine,
      subtype: run('subtype', "it's a Spirit Warrior in addition to its other types", { typeLine: 'Creature' }).typeLine,
      legendaryAdd: run('legendary', "it's legendary", { typeLine: 'Creature — Elf' }).typeLine,
      legendaryRemove: run('legendary', "it's not legendary", elder).typeLine,
      keyword: run('keyword', 'it has first strike, trample and lifelink', courier).keywords,
      gets: (d => [d.power, d.toughness, d.boosted])(run('counters', 'it gets +2/+2', courier)),
      enters: (d => [d.power, d.toughness])(run('counters', 'it enters with two +1/+1 counters on it', courier)),
      color: run('color', "it's colorless", courier).color,
      clause: cd.exceptClause('Twin Lantern enters as a copy of an artifact, except it has “Tap: Add one mana.” and “Gain 1 life.” When it leaves, draw a card.'),
    },
    fixtures: {
      plain: cd.mergeCopy(copier('Glass Mimic', 'You may have Glass Mimic enter as a copy of any creature on the battlefield.'), courier),
      subtypeQuoted: cd.mergeCopy(copier('Mirror Wisp', 'You may have Mirror Wisp enter as a copy of a creature you control, except it\'s a Spirit in addition to its other types and it has "When this enters, look at the top card of your deck."'), courier),
      legendaryCounter: cd.mergeCopy(copier('Echo Sapling', 'Echo Sapling enters as a copy of a creature you control, except it isn\'t legendary and it enters with an additional +1/+1 counter on it.'), elder),
      twoQuoted: cd.mergeCopy(copier('Twin Lantern', 'Twin Lantern enters as a copy of an artifact, except it has “Tap: Add one mana.” and “At the beginning of your upkeep, gain 1 life.” When Twin Lantern leaves, draw a card.'), beacon),
      unknown: cd.mergeCopy(copier('Odd Reflection', 'Odd Reflection enters as a copy of any creature, except its power is equal to the number of cards in your hand.'), courier),
      nameColorKeywords: cd.mergeCopy(copier('Prism Double', 'Prism Double enters as a copy of a creature, except it\'s named Shard Twin, it\'s blue and it has flying and haste.'), courier),
    },
    courier,
  };
});
const mp = merge.patterns, mf = merge.fixtures, same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('copy pattern: quoted abilities', same(mp.quoted, ['Draw a card.', 'Gain 1 life.']), JSON.stringify(mp.quoted));
check('copy pattern: name', mp.name === 'Quiet Echo', mp.name);
check('copy pattern: card type before the dash', mp.cardType === 'Artifact Creature — Golem', mp.cardType);
check('copy pattern: subtypes after the dash', mp.subtype === 'Creature — Spirit Warrior', mp.subtype);
check('copy pattern: legendary add / remove', mp.legendaryAdd === 'Legendary Creature — Elf' && mp.legendaryRemove === 'Creature — Elf Druid', `${mp.legendaryAdd} | ${mp.legendaryRemove}`);
check('copy pattern: keywords', same(mp.keyword, ['First strike', 'Trample', 'Lifelink']), JSON.stringify(mp.keyword));
check('copy pattern: gets +N/+N and +1/+1 counters', same(mp.gets, [2, 2, true]) && same(mp.enters, [2, 2]), JSON.stringify([mp.gets, mp.enters]));
check('copy pattern: color', mp.color === 'colorless', mp.color);
check('except clause ends at the sentence, not inside quotes', mp.clause === 'it has “Tap: Add one mana.” and “Gain 1 life.”', mp.clause);
check('merge: plain copy is the target unchanged', same(mf.plain, { ...merge.courier, notes: '' }), JSON.stringify(mf.plain));
check('merge: subtype + quoted ability', mf.subtypeQuoted.typeLine === 'Creature — Goblin Scout Spirit' && mf.subtypeQuoted.rulesText === merge.courier.rulesText + '\n\nWhen this enters, look at the top card of your deck.' && !mf.subtypeQuoted.notes, JSON.stringify(mf.subtypeQuoted));
check('merge: legendary removed + counter', mf.legendaryCounter.typeLine === 'Creature — Elf Druid' && mf.legendaryCounter.pt === '1/3 (+1/+1)' && !mf.legendaryCounter.notes, JSON.stringify(mf.legendaryCounter));
check('merge: two quoted abilities', mf.twoQuoted.rulesText === 'Tap: Scry 1.\n\nTap: Add one mana.\n\nAt the beginning of your upkeep, gain 1 life.' && !mf.twoQuoted.notes, JSON.stringify(mf.twoQuoted));
check('merge: unrecognized clause lands in notes', mf.unknown.notes === 'its power is equal to the number of cards in your hand' && mf.unknown.rulesText.endsWith('\n\nExcept: its power is equal to the number of cards in your hand'), JSON.stringify(mf.unknown));
check('merge: name, color and keywords', mf.nameColorKeywords.name === 'Shard Twin' && mf.nameColorKeywords.rulesText === merge.courier.rulesText + '\nFlying\nHaste\nColor: blue' && !mf.nameColorKeywords.notes, JSON.stringify(mf.nameColorKeywords));

// Auto-crop on synthetic photos: a bordered card and a borderless card, each
// rotated 7° with mild keystone on a wood-colored background, and a photo with
// no card at all. Invented content only.
await page.evaluate(() => {
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  window.__scenes = {
    card(bordered, { pt } = {}) {
      const c = canvas(700, 980), g = c.getContext('2d');
      if (bordered) {
        g.fillStyle = '#000'; g.fillRect(0, 0, 700, 980);
        g.fillStyle = '#f2eee2'; g.fillRect(40, 40, 620, 900);
      } else {
        g.fillStyle = '#fff'; g.fillRect(0, 0, 700, 980);
        g.strokeStyle = '#ff0'; g.lineWidth = 12; g.strokeRect(26, 26, 648, 928); // covers 20–32 px from each edge
      }
      g.fillStyle = '#7a8fa6'; g.fillRect(80, 150, 540, 400);
      g.fillStyle = '#222'; g.font = 'bold 44px Arial'; g.fillText('Test Card', 80, 110);
      g.font = '30px Arial'; g.fillText('Synthetic face for the crop test.', 80, 640);
      if (pt) { g.font = 'bold 44px Arial'; g.textAlign = 'right'; g.fillText(pt, 640, 915); }
      return c;
    },
    scene(card) {
      const c = canvas(1400, 1900), g = c.getContext('2d');
      g.fillStyle = '#8a5a2e'; g.fillRect(0, 0, 1400, 1900);
      for (let i = 0; i < 70; i++) {
        g.fillStyle = i % 2 ? 'rgba(60, 35, 15, 0.12)' : 'rgba(255, 220, 180, 0.06)';
        g.fillRect(0, (i * 977) % 1900, 1400, 3 + (i * 7) % 9);
      }
      if (card) {
        const k = canvas(700, 980), kg = k.getContext('2d');
        for (let y = 0; y < 980; y++) { const w = 700 * (0.94 + 0.06 * y / 979); kg.drawImage(card, 0, y, 700, 1, (700 - w) / 2, y, w, 1); }
        g.translate(700, 950); g.rotate(7 * Math.PI / 180); g.drawImage(k, -350, -490);
      }
      return c;
    },
  };
});
const crop = await page.evaluate(() => {
  const cd = window.__cardDisplay, S = window.__scenes;
  const set = new Set(cd.PALETTE.map(c => c.join(',')));
  const inPalette = c => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let p = 0; p < d.length; p += 4) if (!set.has(`${d[p]},${d[p + 1]},${d[p + 2]}`)) return false; return true; };
  const ok = c => c.width === 300 && c.height === 400 && inPalette(c);

  const bordered = S.scene(S.card(true));
  const bOut = cd.preparePhoto(bordered);
  const bd = bOut.getContext('2d').getImageData(0, 0, 300, 400).data;
  let sum = 0, count = 0;
  for (let y = 0; y < 400; y++) for (let x = 0; x < 300; x++) {
    if (x >= 9 && x < 291 && y >= 12 && y < 388) continue;
    const p = (y * 300 + x) * 4; sum += 0.2126 * bd[p] + 0.7152 * bd[p + 1] + 0.0722 * bd[p + 2]; count++;
  }

  const borderless = S.scene(S.card(false));
  const lOut = cd.preparePhoto(borderless);
  const ld = lOut.getContext('2d').getImageData(0, 0, 300, 400).data;
  const yellow = (x, y) => { const p = (y * 300 + x) * 4; return ld[p] === 255 && ld[p + 1] === 255 && ld[p + 2] === 0; };
  const firstRow = order => { for (const y of order) { let n = 0; for (let x = 75; x < 225; x++) n += yellow(x, y); if (n > 75) return y; } return -1; };
  const firstCol = order => { for (const x of order) { let n = 0; for (let y = 100; y < 300; y++) n += yellow(x, y); if (n > 100) return x; } return -1; };
  const up = [...Array(400).keys()], across = [...Array(300).keys()];
  const edges = { top: firstRow(up), bottom: 399 - firstRow([...up].reverse()), left: firstCol(across), right: 299 - firstCol([...across].reverse()) };
  // Zero-trim position of the stroke's outer edge in the 300×400 output.
  const expected = { top: 20 / 980 * 400, bottom: 20 / 980 * 400, left: 20 / 700 * 300, right: 20 / 700 * 300 };

  const empty = S.scene(null);
  return {
    bordered: { found: !!cd.detectCard(bordered), ok: ok(bOut), ring: sum / count },
    borderless: { found: !!cd.detectCard(borderless), ok: ok(lOut), edges, off: Object.keys(edges).map(k => Math.abs(edges[k] - expected[k])) },
    empty: { found: cd.detectCard(empty) !== null, ok: ok(cd.preparePhoto(empty)) },
  };
});
check('auto-crop finds a bordered card', crop.bordered.found);
check('bordered card output is 300×400 palette-only', crop.bordered.ok);
check('black border trimmed (outer ring luminance > 120)', crop.bordered.ring > 120, crop.bordered.ring.toFixed(1));
check('auto-crop finds a borderless card', crop.borderless.found);
check('borderless card output is 300×400 palette-only', crop.borderless.ok);
check('borderless card keeps its edge on all four sides (±5 px)', crop.borderless.off.every(v => v <= 5), JSON.stringify(crop.borderless.edges));
check('no card: detectCard returns null', !crop.empty.found);
check('no card: fallback output is 300×400 palette-only', crop.empty.ok);

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
const ptParse = await page.evaluate(() => {
  const p = window.__cardDisplay.parseOcrText;
  return {
    lenient: p('Ember Courier\nCreature - Goblin Scout\nHaste\n212'),
    strict: p('Ember Courier\nCreature - Goblin Scout\nHaste\n3/3'),
    double: p('Stone Colossus\nArtifact Creature - Golem\nTrample\n10110'),
    damage: p('Spark Thrower\nCreature - Goblin\nTap: deal\n212 damage\nto any target.'),
    none: p('Swift Courier\nCreature - Goblin Scout\nHaste'),
  };
});
check('P/T parse: "212" on the last line is 2/2', ptParse.lenient.pt === '2/2' && ptParse.lenient.rulesText === 'Haste', JSON.stringify(ptParse.lenient));
check('P/T parse: "3/3"', ptParse.strict.pt === '3/3' && ptParse.strict.rulesText === 'Haste', JSON.stringify(ptParse.strict));
check('P/T parse: "10110" is 10/10', ptParse.double.pt === '10/10' && ptParse.double.rulesText === 'Trample', JSON.stringify(ptParse.double));
check('P/T parse: "212 damage" mid-text stays text', ptParse.damage.pt === '' && ptParse.damage.rulesText.includes('212 damage'), JSON.stringify(ptParse.damage));
check('P/T parse: last line "Haste" gives no pt', ptParse.none.pt === '' && ptParse.none.rulesText === 'Haste', JSON.stringify(ptParse.none));

// Corner pass: single-line OCR of the straightened card's bottom-right corner.
const corner = await page.evaluate(async () => {
  const cd = window.__cardDisplay, S = window.__scenes;
  const card = cd.detectCard(S.scene(S.card(true, { pt: '2/2' })));
  if (!card) return { found: false };
  const started = performance.now();
  const pt = await cd.ocr.readCorner(cd.prepareCorner(card));
  const ms = Math.round(performance.now() - started);
  const full = await cd.ocr.read(cd.prepareForOcr(card), null, cd.prepareCorner(card));
  return { found: true, pt, ms, fullPt: full.pt, cornerMs: full.cornerMs };
});
check('corner pass reads the P/T', corner.found && corner.pt === '2/2' && corner.fullPt === '2/2', JSON.stringify(corner));
check('corner pass adds well under a second', corner.found && corner.ms < 1000 && corner.cornerMs < 1000, `${corner.ms} ms alone, ${corner.cornerMs} ms after the main pass`);

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
const fullFrameState = await page.evaluate(() => ({ full: document.getElementById('btn-crop-full').getAttribute('aria-pressed'), autoDisabled: document.getElementById('btn-crop-auto').disabled, note: document.getElementById('crop-note').textContent }));
check('no card edge: review defaults to Full frame', fullFrameState.full === 'true' && fullFrameState.autoDisabled, JSON.stringify(fullFrameState));
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

// Crop toggle: a photo with a detectable card opens on Auto; Full frame redraws the preview.
const scenePng = await page.evaluate(async () => {
  const c = window.__scenes.scene(window.__scenes.card(true));
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
});
const scenePath = resolve(outDir, 'scene.png');
await writeFile(scenePath, Buffer.from(scenePng));
await page.click('#btn-scan');
await page.click('#btn-sheet-continue');
await page.waitForSelector('#screen-camera:not([hidden])');
await page.setInputFiles('#file-library', scenePath);
await page.waitForSelector('#screen-review:not([hidden])', { timeout: 15000 });
const previewSig = () => page.evaluate(() => { const d = document.getElementById('review-canvas').getContext('2d').getImageData(0, 0, 300, 400).data; let s = 0; for (let i = 0; i < d.length; i += 4) s = (s * 31 + d[i] + d[i + 1] * 7 + d[i + 2] * 13) % 1000000007; return s; });
const autoState = await page.evaluate(() => ({ auto: document.getElementById('btn-crop-auto').getAttribute('aria-pressed'), note: document.getElementById('crop-note').textContent }));
const autoSig = await previewSig();
await page.screenshot({ path: resolve(outDir, 'review-auto.png'), fullPage: true });
await page.click('#btn-crop-full');
const fullSig = await previewSig();
const toggled = await page.evaluate(() => document.getElementById('btn-crop-full').getAttribute('aria-pressed'));
check('card found: review defaults to Auto', autoState.auto === 'true' && /found/i.test(autoState.note), JSON.stringify(autoState));
check('Crop toggle redraws the preview', toggled === 'true' && autoSig !== fullSig);
await page.click('#btn-back');
await page.waitForSelector('#screen-library:not([hidden])');
// Copy card from two photos: scan the copier, scan the target, review, save.
const cardPng = async lines => page.evaluate(async lines => {
  const c = document.createElement('canvas'); c.width = 900; c.height = 1200;
  const g = c.getContext('2d'); g.fillStyle = '#f4efe2'; g.fillRect(0, 0, 900, 1200); g.fillStyle = '#000';
  for (const [text, font, x, y] of lines) { g.font = font; g.fillText(text, x, y); }
  const b = await new Promise(r => c.toBlob(r, 'image/png'));
  return Array.from(new Uint8Array(await b.arrayBuffer()));
}, lines);
const copierPath = resolve(outDir, 'copier.png'), targetPath = resolve(outDir, 'target.png');
await writeFile(copierPath, Buffer.from(await cardPng([['Glass Mimic', 'bold 52px Arial', 60, 110], ['Creature - Shapeshifter', '40px Arial', 60, 760], ['Enter as a copy of a creature,', '36px Arial', 60, 850], ['except it has haste.', '36px Arial', 60, 910]])));
await writeFile(targetPath, Buffer.from(await cardPng([['Ember Courier', 'bold 52px Arial', 60, 110], ['Creature - Goblin Scout', '40px Arial', 60, 760], ['Whenever Ember Courier attacks,', '36px Arial', 60, 850], ['draw a card.', '36px Arial', 60, 910], ['2/2', 'bold 40px Arial', 760, 1140]])));
const scanCopyStep = async path => {
  await page.click('#btn-cs-scan');
  await page.click('#btn-sheet-continue');
  await page.waitForSelector('#screen-camera:not([hidden])');
  await page.setInputFiles('#file-library', path);
  await page.waitForSelector('#screen-copystep:not([hidden])', { timeout: 15000 });
  await page.waitForFunction(() => /Text read|No text|not available/.test(document.getElementById('cs-ocr-label').textContent), null, { timeout: 60000 });
  return page.evaluate(() => ({ name: document.getElementById('cs-name').value, rules: document.getElementById('cs-rules').value, pt: document.getElementById('cs-pt').value }));
};
await page.click('#btn-copy');
await page.waitForSelector('#screen-copystep:not([hidden])');
const step1 = await scanCopyStep(copierPath);
check('copy step 1: OCR read the copying card', /glass mimic/i.test(step1.name), JSON.stringify(step1));
await page.fill('#cs-name', 'Glass Mimic');
await page.fill('#cs-rules', 'Enter as a copy of a creature, except it has haste.');
await page.click('#btn-cs-next');
const step2 = await scanCopyStep(targetPath);
check('copy step 2: OCR read the copied card and its P/T', /ember courier/i.test(step2.name) && step2.pt === '2/2', JSON.stringify(step2));
await page.fill('#cs-name', 'Ember Courier');
await page.fill('#cs-type', 'Creature — Goblin Scout');
await page.fill('#cs-rules', 'Whenever Ember Courier attacks, draw a card.');
await page.fill('#cs-pt', '2/2');
await page.click('#btn-cs-next');
await page.waitForSelector('#screen-copy:not([hidden])');
const copyReview = await page.evaluate(() => ({ name: document.getElementById('c-title').value, rules: document.getElementById('c-rules').value, pt: document.getElementById('c-pt').value, source: document.getElementById('c-source').value, target: document.getElementById('c-target').value }));
check('copy review shows the merged card', copyReview.name === 'Ember Courier' && copyReview.rules.endsWith('\nHaste') && copyReview.pt === '2/2' && copyReview.source === 'Glass Mimic' && copyReview.target === 'Ember Courier', JSON.stringify(copyReview));
await page.waitForTimeout(200);
await page.screenshot({ path: resolve(outDir, 'copy-review.png'), fullPage: true });
await page.click('#btn-copy-save');
await page.waitForSelector('#screen-final:not([hidden])', { timeout: 10000 });
const savedCopy = await page.evaluate(async () => {
  const cd = window.__cardDisplay;
  const rec = (await cd.repo.all('mtg')).find(r => r.isCopy);
  if (!rec) return null;
  const bmp = await createImageBitmap(new Blob([await cd.repo.imageBytes(rec)], { type: 'image/png' }));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d'); g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data, set = new Set(cd.PALETTE.map(p => p.join(',')));
  let palette = true;
  for (let p = 0; p < d.length; p += 4) if (!set.has(`${d[p]},${d[p + 1]},${d[p + 2]}`) || d[p + 3] !== 255) { palette = false; break; }
  return { isCopy: rec.isCopy, sourceCardName: rec.sourceCardName, copiedCardName: rec.copiedCardName, pt: rec.pt, w: c.width, h: c.height, palette };
});
check('saved copy record has isCopy, sourceCardName, copiedCardName', !!savedCopy && savedCopy.isCopy === true && savedCopy.sourceCardName === 'Glass Mimic' && savedCopy.copiedCardName === 'Ember Courier', JSON.stringify(savedCopy));
check('saved copy image is 300×400 palette-only', !!savedCopy && savedCopy.w === 300 && savedCopy.h === 400 && savedCopy.palette);
const finalMeta = await page.evaluate(() => document.getElementById('final-meta').textContent);
check('final screen lists P/T and Copy of', /P\/T2\/2 \(|P\/T2\/2/.test(finalMeta) && /Copy ofEmber Courier/.test(finalMeta), JSON.stringify(finalMeta));
await page.screenshot({ path: resolve(outDir, 'copy-final.png'), fullPage: true });
await page.click('#btn-final-back');
await page.waitForSelector('#screen-library:not([hidden])');

// Library thumbnails are smooth 96×128 images; the final preview stays pixelated.
await page.waitForFunction(() => [...document.querySelectorAll('#list .thumb')].every(t => t.complete && t.naturalWidth > 0), null, { timeout: 10000 });
const thumbState = await page.evaluate(() => {
  const t = document.querySelector('#list .thumb');
  return { w: t.naturalWidth, h: t.naturalHeight, rendering: getComputedStyle(t).imageRendering, count: document.querySelectorAll('#list .row').length };
});
check('library thumbnails are smooth 96×128', thumbState.w === 96 && thumbState.h === 128 && thumbState.rendering !== 'pixelated', JSON.stringify(thumbState));

// The Rotate 90° choice is remembered as the default.
await page.click('#list .row');
await page.waitForSelector('#screen-final:not([hidden])');
const rotateBefore = await page.evaluate(() => ({ checked: document.getElementById('f-rotate').checked, rendering: getComputedStyle(document.getElementById('final-img')).imageRendering }));
await page.check('#f-rotate');
await page.click('#btn-final-back');
await page.waitForSelector('#screen-library:not([hidden])');
await page.click('#list .row');
await page.waitForSelector('#screen-final:not([hidden])');
const rotateAfter = await page.evaluate(() => ({ checked: document.getElementById('f-rotate').checked, landscape: document.getElementById('final-img').classList.contains('landscape'), stored: localStorage.getItem('card_display.rotate') }));
check('final preview stays pixelated', rotateBefore.rendering === 'pixelated', rotateBefore.rendering);
check('Rotate 90° is remembered as the default', !rotateBefore.checked && rotateAfter.checked && rotateAfter.landscape && rotateAfter.stored === 'true', JSON.stringify(rotateAfter));
await page.click('#btn-final-back');
await page.waitForSelector('#screen-library:not([hidden])');

const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
check('no horizontal overflow at 400px', !overflow);
check('no page errors', errors.length === 0, errors.join(' | '));

await browser.close();
server.close();
console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
process.exit(failures.length ? 1 : 0);
