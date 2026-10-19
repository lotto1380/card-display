/* Card Display — web app.
   Ports the Flutter MVP's ImageProcessor, OcrService parse, SecureCardStore and
   CardRepository to the browser. Everything runs on the device; nothing is uploaded. */
(() => {
  'use strict';

  const APP_VERSION = '0.3.0';

  // ---------------------------------------------------------------------------
  // Output contract
  // ---------------------------------------------------------------------------
  const W = 300, H = 400;
  const PALETTE = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [255, 255, 0]];
  const GAMES = {
    mtg: { label: 'Magic: The Gathering', short: 'MTG' },
    swu: { label: 'Star Wars: Unlimited', short: 'SWU' },
    custom: { label: 'Other game', short: 'Other' },
  };

  function nearestColor(r, g, b) {
    let best = PALETTE[0], bestDistance = Infinity;
    for (let i = 0; i < PALETTE.length; i++) {
      const c = PALETTE[i];
      const dr = r - c[0], dg = g - c[1], db = b - c[2];
      const d = 0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db;
      if (d < bestDistance) { bestDistance = d; best = c; }
    }
    return best;
  }

  // Floyd–Steinberg error diffusion to the four-color palette. Same weights, scan
  // order, and clamp-before-quantize as the Flutter ImageProcessor.
  function ditherFourColors(imageData) {
    const { width, height, data } = imageData;
    const er = new Float32Array(width * height);
    const eg = new Float32Array(width * height);
    const eb = new Float32Array(width * height);
    const spread = (x, y, dr, dg, db, f) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const i = y * width + x;
      er[i] += dr * f; eg[i] += dg * f; eb[i] += db * f;
    };
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x, p = i * 4;
        const r = Math.min(255, Math.max(0, data[p] + er[i]));
        const g = Math.min(255, Math.max(0, data[p + 1] + eg[i]));
        const b = Math.min(255, Math.max(0, data[p + 2] + eb[i]));
        const c = nearestColor(r, g, b);
        data[p] = c[0]; data[p + 1] = c[1]; data[p + 2] = c[2]; data[p + 3] = 255;
        const dr = r - c[0], dg = g - c[1], db = b - c[2];
        spread(x + 1, y, dr, dg, db, 7 / 16);
        spread(x - 1, y + 1, dr, dg, db, 3 / 16);
        spread(x, y + 1, dr, dg, db, 5 / 16);
        spread(x + 1, y + 1, dr, dg, db, 1 / 16);
      }
    }
    return imageData;
  }

  // Snap every pixel to the nearest palette color, no diffusion (used for text cards).
  function snapToPalette(imageData) {
    const d = imageData.data;
    for (let p = 0; p < d.length; p += 4) {
      const c = nearestColor(d[p], d[p + 1], d[p + 2]);
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
    return imageData;
  }

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function sourceSize(img) {
    return { w: img.naturalWidth || img.videoWidth || img.width, h: img.naturalHeight || img.videoHeight || img.height };
  }

  // Draw a region of an image into a target size, halving in steps so large
  // phone photos downscale cleanly in every browser.
  function drawScaled(img, sx, sy, sw, sh, dw, dh) {
    let src = img, cx = sx, cy = sy, cw = sw, ch = sh;
    while (cw / 2 >= dw && ch / 2 >= dh) {
      const nw = Math.floor(cw / 2), nh = Math.floor(ch / 2);
      const c = makeCanvas(nw, nh);
      const g = c.getContext('2d');
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(src, cx, cy, cw, ch, 0, 0, nw, nh);
      src = c; cx = 0; cy = 0; cw = nw; ch = nh;
    }
    const out = makeCanvas(dw, dh);
    const g = out.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(src, cx, cy, cw, ch, 0, 0, dw, dh);
    return out;
  }

  // Center crop to 3:4 (port of ImageProcessor._centerCrop).
  function cropRect(img) {
    const { w: sw, h: sh } = sourceSize(img);
    const target = 3 / 4;
    if (sw / sh > target) {
      const cw = Math.round(sh * target);
      return { x: Math.floor((sw - cw) / 2), y: 0, w: cw, h: sh };
    }
    const ch = Math.round(sw / target);
    return { x: 0, y: Math.floor((sh - ch) / 2), w: sw, h: ch };
  }

  // Port of ImageProcessor.inspectFile: glare ratio and a crude detail score.
  function inspectImage(img) {
    const { w: iw, h: ih } = sourceSize(img);
    const w = 240, h = Math.max(2, Math.round(ih * (240 / iw)));
    const c = drawScaled(img, 0, 0, iw, ih, w, h);
    const d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
    let highlights = 0, samples = 0, detail = 0;
    for (let y = 1; y < h - 1; y += 2) {
      for (let x = 1; x < w - 1; x += 2) {
        const p = (y * w + x) * 4;
        const r = d[p], g = d[p + 1], b = d[p + 2];
        if (r > 245 && g > 245 && b > 245) highlights++;
        const q = p + 4;
        detail += Math.abs(lum(r, g, b) - lum(d[q], d[q + 1], d[q + 2]));
        samples++;
      }
    }
    const highlightRatio = samples ? highlights / samples : 0;
    const detailScore = samples ? detail / samples : 0;
    const warnings = [];
    if (highlightRatio > 0.035) warnings.push('Strong glare detected. Remove the sleeve or change the camera angle.');
    if (detailScore < 12) warnings.push('The image may be blurry. Hold the phone steady and retake it.');
    return { highlightRatio, detailScore, warnings };
  }

  // Port of ImageProcessor.preparePhoto: center-crop to 3:4, resize to 300×400, dither.
  function preparePhoto(img) {
    const r = cropRect(img);
    const c = drawScaled(img, r.x, r.y, r.w, r.h, W, H);
    const g = c.getContext('2d');
    g.putImageData(ditherFourColors(g.getImageData(0, 0, W, H)), 0, 0);
    return c;
  }

  // Grayscale, contrast-stretched crop at OCR-friendly resolution.
  function prepareForOcr(img) {
    const r = cropRect(img);
    const maxH = 1600;
    const scale = Math.min(1, maxH / r.h);
    const dw = Math.max(1, Math.round(r.w * scale)), dh = Math.max(1, Math.round(r.h * scale));
    const c = drawScaled(img, r.x, r.y, r.w, r.h, dw, dh);
    const g = c.getContext('2d');
    const id = g.getImageData(0, 0, dw, dh);
    const d = id.data;
    let min = 255, max = 0;
    const gray = new Uint8ClampedArray(dw * dh);
    for (let p = 0, i = 0; p < d.length; p += 4, i++) {
      const v = Math.round(0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]);
      gray[i] = v;
      if (v < min) min = v; if (v > max) max = v;
    }
    const range = Math.max(1, max - min);
    for (let p = 0, i = 0; p < d.length; p += 4, i++) {
      const v = Math.round(((gray[i] - min) / range) * 255);
      d[p] = v; d[p + 1] = v; d[p + 2] = v; d[p + 3] = 255;
    }
    g.putImageData(id, 0, 0);
    return c;
  }

  // ---------------------------------------------------------------------------
  // Text-only Copy Card (port of buildTextOnlyCard, wrapping by measured width)
  // ---------------------------------------------------------------------------
  const FONT_STACK = '"IBM Plex Sans", "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  function ellipsizeToWidth(g, text, maxWidth) {
    const clean = text.trim();
    if (g.measureText(clean).width <= maxWidth) return clean;
    let s = clean;
    while (s.length > 1 && g.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
    return s.trimEnd() + '…';
  }

  function wrapToWidth(g, text, maxWidth) {
    const out = [];
    for (const paragraph of text.replace(/\r/g, '').split('\n')) {
      const words = paragraph.trim().split(/\s+/);
      let line = '';
      for (const word of words) {
        if (!word) continue;
        const candidate = line ? line + ' ' + word : word;
        if (g.measureText(candidate).width <= maxWidth) line = candidate;
        else {
          if (line) out.push(line);
          if (g.measureText(word).width <= maxWidth) line = word;
          else {
            let chunk = '';
            for (const ch of word) {
              if (g.measureText(chunk + ch).width <= maxWidth) chunk += ch;
              else { out.push(chunk); chunk = ch; }
            }
            line = chunk;
          }
        }
      }
      if (line) out.push(line);
      if (!paragraph.trim()) out.push('');
    }
    return out;
  }

  function buildTextCard({ title, typeLine, rulesText, sourceCardName }) {
    const c = makeCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ff0'; g.fillRect(0, 0, W, 47);
    g.fillStyle = '#f00'; g.fillRect(0, 47, W, 5);
    g.fillStyle = '#000';
    g.fillRect(1, 1, 298, 3); g.fillRect(1, 396, 298, 3); g.fillRect(1, 1, 3, 398); g.fillRect(296, 1, 3, 398);
    g.textBaseline = 'top';
    g.font = `700 24px ${FONT_STACK}`;
    g.fillStyle = '#000';
    g.fillText(ellipsizeToWidth(g, title || 'Copied card', 280), 10, 10);
    let y = 62;
    g.font = `500 14px ${FONT_STACK}`;
    if (sourceCardName && sourceCardName.trim()) {
      g.fillStyle = '#f00';
      g.fillText(ellipsizeToWidth(g, 'Copied by: ' + sourceCardName.trim(), 280), 10, y);
      y += 23;
    }
    g.fillStyle = '#000';
    for (const line of wrapToWidth(g, typeLine || '', 280)) { g.fillText(line, 10, y); y += 18; }
    y += 7;
    g.fillRect(10, y, 280, 2);
    y += 10;
    for (const line of wrapToWidth(g, rulesText || '', 280)) {
      if (y > 376) break;
      g.fillText(line, 10, y); y += 18;
    }
    g.putImageData(snapToPalette(g.getImageData(0, 0, W, H)), 0, 0);
    return c;
  }

  function rotateCanvas(src) { // 300×400 → 400×300, clockwise
    const c = makeCanvas(src.height, src.width);
    const g = c.getContext('2d');
    g.translate(c.width, 0); g.rotate(Math.PI / 2);
    g.drawImage(src, 0, 0);
    return c;
  }

  function canvasToPngBytes(c) {
    return new Promise((resolve, reject) => {
      c.toBlob(b => b ? b.arrayBuffer().then(resolve, reject) : reject(new Error('PNG encode failed')), 'image/png');
    });
  }

  async function bytesToCanvas(bytes) {
    const blob = new Blob([bytes], { type: 'image/png' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = makeCanvas(img.naturalWidth, img.naturalHeight);
      c.getContext('2d').drawImage(img, 0, 0);
      return c;
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------------------------------------------------------------------------
  // OCR (port of OcrService._parse; recognition by Tesseract.js, on device)
  // ---------------------------------------------------------------------------
  const TYPE_WORDS = ['creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery', 'land', 'unit', 'upgrade', 'event'];

  function parseOcrText(rawText) {
    const lines = rawText.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 1);
    if (!lines.length) return { name: '', typeLine: '', rulesText: '', rawText: '' };
    const name = lines[0];
    let typeIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      if (TYPE_WORDS.some(w => lower.includes(w))) { typeIndex = i; break; }
    }
    const typeLine = typeIndex >= 0 ? lines[typeIndex] : '';
    const rulesStart = typeIndex >= 0 ? typeIndex + 1 : 1;
    const rulesText = lines.slice(rulesStart).filter(line => {
      const lower = line.toLowerCase();
      return !/^\d+\s*\/\s*\d+$/.test(line) && !lower.includes('©') && !lower.startsWith('illus.');
    }).join('\n');
    return { name, typeLine, rulesText, rawText };
  }

  const ocr = {
    worker: null, loading: null, state: 'idle', // idle | loading | ready | failed
    async ensureScript() {
      if (window.Tesseract) return;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/tesseract/tesseract.min.js';
        s.onload = resolve; s.onerror = () => reject(new Error('Could not load the text recognizer.'));
        document.head.append(s);
      });
    },
    async ensureWorker(onProgress) {
      if (this.worker) return this.worker;
      if (this.loading) return this.loading;
      this.state = 'loading';
      this.loading = (async () => {
        await this.ensureScript();
        const worker = await window.Tesseract.createWorker('eng', 1, {
          workerPath: 'vendor/tesseract/worker.min.js',
          corePath: 'vendor/tesseract',
          langPath: 'vendor/tessdata',
          gzip: true,
          logger: m => onProgress && onProgress(m),
          errorHandler: () => {},
        });
        this.worker = worker; this.state = 'ready';
        return worker;
      })().catch(err => { this.state = 'failed'; this.loading = null; throw err; });
      return this.loading;
    },
    async read(canvas, onProgress) {
      const worker = await this.ensureWorker(onProgress);
      const result = await worker.recognize(canvas);
      return parseOcrText(result.data.text || '');
    },
  };

  // ---------------------------------------------------------------------------
  // Storage: IndexedDB + AES-GCM (port of SecureCardStore + CardRepository)
  // ---------------------------------------------------------------------------
  const store = {
    db: null, key: null, mode: 'memory', // 'encrypted' | 'plain' | 'memory'
    mem: { cards: new Map(), corrections: new Map() },
  };

  function idb(storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = store.db.transaction(storeName, mode);
      const req = fn(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(req && req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function initStorage() {
    try {
      if (!window.indexedDB) throw new Error('no idb');
      store.db = await new Promise((resolve, reject) => {
        const req = indexedDB.open('card_display', 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('corrections')) db.createObjectStore('corrections');
          if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('blocked'));
      });
      store.mode = 'plain';
      if (window.crypto && crypto.subtle) {
        try {
          let key = await idb('keys', 'readonly', s => s.get('image-key-v1'));
          if (!key) {
            key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
            await idb('keys', 'readwrite', s => s.put(key, 'image-key-v1'));
            key = await idb('keys', 'readonly', s => s.get('image-key-v1'));
          }
          if (key) { store.key = key; store.mode = 'encrypted'; }
        } catch (e) { /* stay in plain mode */ }
      }
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    } catch (e) {
      store.db = null; store.mode = 'memory';
    }
  }

  // Payload format mirrors the Dart store: version byte, 12-byte nonce, then
  // ciphertext. WebCrypto appends the 16-byte GCM tag to the ciphertext instead of
  // storing it separately. Version 0 = stored without encryption.
  async function sealBytes(bytes) {
    if (store.mode !== 'encrypted') {
      const out = new Uint8Array(1 + bytes.byteLength); out[0] = 0; out.set(new Uint8Array(bytes), 1); return out.buffer;
    }
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, store.key, bytes));
    const out = new Uint8Array(1 + 12 + ct.length);
    out[0] = 1; out.set(nonce, 1); out.set(ct, 13);
    return out.buffer;
  }

  async function openBytes(payload) {
    const u = new Uint8Array(payload);
    if (u[0] === 0) return u.slice(1).buffer;
    if (u[0] !== 1) throw new Error('Unsupported stored image format.');
    if (!store.key) throw new Error('This browser cannot read its encrypted cards.');
    const nonce = u.slice(1, 13), ct = u.slice(13);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, store.key, ct);
  }

  const repo = {
    async all(game) {
      let records;
      if (store.db) {
        try { records = await idb('cards', 'readonly', s => s.getAll()); } catch (e) { records = [...store.mem.cards.values()]; }
      } else records = [...store.mem.cards.values()];
      return records.filter(r => !game || r.game === game).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    async save({ game, name, typeLine, rulesText, pngBytes, isCopy = false, sourceCardName = null }) {
      const now = Date.now();
      const record = {
        id: uuid(), game,
        name: name.trim() || 'Untitled card',
        typeLine: typeLine.trim(), rulesText: rulesText.trim(),
        createdAt: now, updatedAt: now, isCopy, sourceCardName,
        payload: await sealBytes(pngBytes),
      };
      if (store.db) { try { await idb('cards', 'readwrite', s => s.put(record)); return record; } catch (e) { /* fall through */ } }
      store.mem.cards.set(record.id, record);
      return record;
    },
    async touch(record) {
      record.updatedAt = Date.now();
      if (store.db) { try { await idb('cards', 'readwrite', s => s.put(record)); return; } catch (e) { /* fall through */ } }
      store.mem.cards.set(record.id, record);
    },
    async remove(id) {
      if (store.db) { try { await idb('cards', 'readwrite', s => s.delete(id)); } catch (e) { /* ignore */ } }
      store.mem.cards.delete(id);
    },
    async clear() {
      if (store.db) {
        try { await idb('cards', 'readwrite', s => s.clear()); await idb('corrections', 'readwrite', s => s.clear()); } catch (e) { /* ignore */ }
      }
      store.mem.cards.clear(); store.mem.corrections.clear();
    },
    async imageBytes(record) { return openBytes(record.payload); },
    correctionKey(game, name) { return `${game}_${name.trim().toLowerCase().replace(/\s+/g, ' ')}`; },
    async saveCorrection(game, name, correction) {
      const key = this.correctionKey(game, name);
      if (store.db) { try { await idb('corrections', 'readwrite', s => s.put(correction, key)); return; } catch (e) { /* fall through */ } }
      store.mem.corrections.set(key, correction);
    },
    async correctionFor(game, name) {
      const key = this.correctionKey(game, name);
      if (store.db) { try { const v = await idb('corrections', 'readonly', s => s.get(key)); if (v) return v; } catch (e) { /* fall through */ } }
      return store.mem.corrections.get(key) || null;
    },
  };

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  function safeName(name) {
    return name.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'card';
  }

  // ---------------------------------------------------------------------------
  // Transfer adapters. Direct NFC transfer to the Santek display needs the
  // vendor SDK inside a native shell (Capacitor plugin); until then the PNG is
  // handed to the Santek EZ Sign app through the share sheet or a download.
  // ---------------------------------------------------------------------------
  const transfer = {
    share: {
      id: 'share', label: 'Send to EZ Sign app',
      isAvailable() {
        if (!navigator.share || !navigator.canShare) return false;
        try { return navigator.canShare({ files: [new File([new Uint8Array([137, 80, 78, 71])], 'probe.png', { type: 'image/png' })] }); }
        catch (e) { return false; }
      },
      async send(pngBytes, filename) {
        const file = new File([pngBytes], filename, { type: 'image/png' });
        await navigator.share({ files: [file], title: filename });
      },
    },
    download: {
      id: 'download', label: 'Download PNG',
      isAvailable() { return true; },
      async send(pngBytes, filename) {
        const url = URL.createObjectURL(new Blob([pngBytes], { type: 'image/png' }));
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.rel = 'noopener';
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      },
    },
    nfc: null, // Santek EZ Sign: ISO-DEP APDU transfer; Web NFC is NDEF-only and iOS has none.
  };

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  const $ = id => document.getElementById(id);
  const screens = ['home', 'library', 'camera', 'review', 'final', 'copy', 'settings'];
  const state = { screen: 'home', game: null, review: null, current: null, currentCanvas: null, history: [], objectUrls: [], ocrJob: 0 };

  function show(screen, title) {
    if (state.screen === 'camera' && screen !== 'camera') camera.stop();
    for (const s of screens) $('screen-' + s).hidden = s !== screen;
    state.screen = screen;
    $('title').textContent = title || 'Card Display';
    $('btn-back').hidden = screen === 'home';
    $('btn-settings').hidden = screen === 'settings';
    window.scrollTo(0, 0);
  }

  let toastTimer;
  function toast(message, ms = 3200) {
    const t = $('toast');
    t.textContent = message; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  function formatDate(ts) {
    try { return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); } catch (e) { return ''; }
  }

  function releaseObjectUrls() {
    for (const u of state.objectUrls) URL.revokeObjectURL(u);
    state.objectUrls = [];
  }

  // Home
  for (const tile of document.querySelectorAll('.tile')) {
    tile.addEventListener('click', () => openLibrary(tile.dataset.game));
  }

  async function openLibrary(game) {
    state.game = game;
    $('search').value = '';
    show('library', GAMES[game].short);
    await renderLibrary();
  }

  async function renderLibrary() {
    const list = $('list');
    const query = $('search').value.trim().toLowerCase();
    const all = await repo.all(state.game);
    let records = all;
    if (query) records = records.filter(r => `${r.name} ${r.typeLine} ${r.rulesText}`.toLowerCase().includes(query));
    else records = records.slice(0, 10);
    $('list-label').textContent = query ? `${records.length} match${records.length === 1 ? '' : 'es'}` : 'Recently used';
    releaseObjectUrls();
    list.replaceChildren();
    if (!records.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      const strong = document.createElement('strong');
      const span = document.createElement('span'); span.className = 'small';
      strong.textContent = query ? 'No matches' : 'No cards yet';
      span.textContent = query ? 'Try a shorter search.' : 'Scan a card to make your first four-color image.';
      empty.append(strong, span);
      list.append(empty);
      return;
    }
    const versionCount = new Map();
    for (const r of all) versionCount.set(r.name.toLowerCase(), (versionCount.get(r.name.toLowerCase()) || 0) + 1);
    for (const r of records) {
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'row';
      const thumb = document.createElement('img');
      thumb.className = 'thumb'; thumb.alt = '';
      const t = document.createElement('div'); t.className = 't';
      const n = document.createElement('div'); n.className = 'n'; n.textContent = r.name;
      const m = document.createElement('div'); m.className = 'm';
      m.textContent = [r.typeLine, formatDate(r.updatedAt)].filter(Boolean).join(' · ');
      t.append(n, m);
      const chip = document.createElement('span');
      chip.className = 'chip' + (r.isCopy ? ' copy' : '');
      const versions = versionCount.get(r.name.toLowerCase()) || 1;
      chip.textContent = r.isCopy ? 'Copy' : (versions > 1 ? `${versions} versions` : 'Scan');
      row.append(thumb, t, chip);
      row.addEventListener('click', () => openFinal(r));
      list.append(row);
      repo.imageBytes(r).then(bytes => {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        state.objectUrls.push(url); thumb.src = url;
      }).catch(() => { thumb.alt = 'Unreadable'; });
    }
  }
  $('search').addEventListener('input', () => { renderLibrary(); });

  // Sleeve warning, then camera
  $('btn-scan').addEventListener('click', () => { $('sheet').hidden = false; $('btn-sheet-continue').focus(); });
  $('btn-sheet-cancel').addEventListener('click', () => { $('sheet').hidden = true; });
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) $('sheet').hidden = true; });
  $('btn-sheet-continue').addEventListener('click', () => { $('sheet').hidden = true; openCamera(); });

  // Camera
  const camera = {
    stream: null,
    async start() {
      const video = $('camera-video');
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('unsupported');
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2048 }, height: { ideal: 1536 } },
        audio: false,
      });
      video.srcObject = this.stream;
      await video.play();
    },
    stop() {
      if (this.stream) { for (const t of this.stream.getTracks()) t.stop(); this.stream = null; }
      const video = $('camera-video');
      if (video.srcObject) video.srcObject = null;
    },
    frame() {
      const video = $('camera-video');
      const c = makeCanvas(video.videoWidth, video.videoHeight);
      c.getContext('2d').drawImage(video, 0, 0);
      return c;
    },
  };

  async function openCamera() {
    show('camera', 'Scan card');
    const msg = $('camera-msg');
    msg.hidden = true;
    $('btn-capture').disabled = false;
    try {
      await camera.start();
    } catch (e) {
      $('btn-capture').disabled = true;
      msg.textContent = e && e.message === 'unsupported'
        ? 'Live preview is not available in this browser. Use the camera app instead.'
        : 'Camera access was not allowed. Use the camera app or choose a photo instead.';
      msg.hidden = false;
    }
  }

  $('btn-capture').addEventListener('click', async () => {
    const video = $('camera-video');
    if (!video.videoWidth) { toast('The camera is still starting.'); return; }
    const frame = camera.frame();
    camera.stop();
    await processSource(frame);
  });
  $('btn-camera-app').addEventListener('click', () => { camera.stop(); $('file-camera').value = ''; $('file-camera').click(); });
  $('btn-choose').addEventListener('click', () => { camera.stop(); $('file-library').value = ''; $('file-library').click(); });
  $('file-camera').addEventListener('change', e => handleFile(e.target.files && e.target.files[0]));
  $('file-library').addEventListener('change', e => handleFile(e.target.files && e.target.files[0]));

  async function handleFile(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      await processSource(img);
      img.src = '';
    } catch (e) {
      toast('That photo could not be read. Try again with a JPEG or PNG.');
    } finally { URL.revokeObjectURL(url); }
  }

  async function processSource(source) {
    toast('Processing photo…', 8000);
    try {
      const quality = inspectImage(source);
      const processed = preparePhoto(source);
      const ocrCanvas = prepareForOcr(source);
      state.review = { canvas: processed, warnings: quality.warnings, ocrCanvas };
      $('toast').hidden = true;
      openReview();
    } catch (e) {
      toast('That photo could not be processed.');
    }
  }

  function openReview() {
    const { canvas, warnings } = state.review;
    const warn = $('review-warn');
    if (warnings.length) {
      warn.replaceChildren();
      const h = document.createElement('strong'); h.textContent = 'Check the photo';
      warn.append(h);
      for (const w of warnings) { const p = document.createElement('p'); p.textContent = w; warn.append(p); }
      warn.hidden = false;
    } else warn.hidden = true;
    $('review-canvas').getContext('2d').drawImage(canvas, 0, 0);
    $('f-name').value = ''; $('f-type').value = ''; $('f-rules').value = '';
    show('review', 'Review');
    runOcr();
  }

  async function runOcr() {
    const job = ++state.ocrJob;
    const status = $('ocr-status'), label = $('ocr-label'), pct = $('ocr-pct'), bar = $('ocr-bar');
    const source = state.review && state.review.ocrCanvas;
    if (!source) return;
    status.hidden = false; label.textContent = ocr.worker ? 'Reading the card text…' : 'Loading the text recognizer (first time only)…';
    pct.textContent = ''; bar.style.width = '0%';
    const onProgress = m => {
      if (job !== state.ocrJob) return;
      if (m && m.status === 'recognizing text') {
        label.textContent = 'Reading the card text…';
        const p = Math.round((m.progress || 0) * 100);
        pct.textContent = p + '%'; bar.style.width = p + '%';
      } else if (m && m.status && m.status !== 'recognizing text') {
        bar.style.width = '15%';
      }
    };
    try {
      const parsed = await ocr.read(source, onProgress);
      if (job !== state.ocrJob) return;
      state.review.ocrCanvas = null;
      bar.style.width = '100%'; pct.textContent = '';
      if (!parsed.name && !parsed.typeLine && !parsed.rulesText) {
        label.textContent = 'No text found. Type the card details below.';
        return;
      }
      label.textContent = 'Text read. Check it and fix anything that is off.';
      const correction = parsed.name ? await repo.correctionFor(state.game, parsed.name) : null;
      if (!$('f-name').value.trim()) $('f-name').value = (correction && correction.name) || parsed.name;
      if (!$('f-type').value.trim()) $('f-type').value = (correction && correction.typeLine) || parsed.typeLine;
      if (!$('f-rules').value.trim()) $('f-rules').value = (correction && correction.rulesText) || parsed.rulesText;
      if (correction) toast('Filled from your earlier correction.');
    } catch (e) {
      if (job !== state.ocrJob) return;
      bar.style.width = '0%'; pct.textContent = '';
      label.textContent = 'Text recognition is not available right now. Type the card details below.';
    }
  }

  $('f-name').addEventListener('change', async () => {
    const name = $('f-name').value;
    if (!name.trim()) return;
    const correction = await repo.correctionFor(state.game, name);
    if (!correction) return;
    if (!$('f-type').value.trim()) $('f-type').value = correction.typeLine || '';
    if (!$('f-rules').value.trim()) $('f-rules').value = correction.rulesText || '';
  });

  $('btn-retake').addEventListener('click', () => {
    state.ocrJob++;
    state.review = null;
    openCamera();
  });

  $('btn-confirm').addEventListener('click', async () => {
    if (!state.review) return;
    const btn = $('btn-confirm'); btn.disabled = true;
    state.ocrJob++;
    try {
      const pngBytes = await canvasToPngBytes(state.review.canvas);
      const name = $('f-name').value, typeLine = $('f-type').value, rulesText = $('f-rules').value;
      const record = await repo.save({ game: state.game, name, typeLine, rulesText, pngBytes });
      await repo.saveCorrection(state.game, record.name, { name: record.name, typeLine: record.typeLine, rulesText: record.rulesText });
      state.review = null;
      toast(store.mode === 'memory' ? 'Saved for this visit only. This browser blocks storage.' : 'Saved.');
      openFinal(record);
    } catch (e) {
      toast('Could not save the card. ' + (e && e.message ? e.message : ''));
    } finally { btn.disabled = false; }
  });

  // Final
  async function openFinal(record) {
    state.current = record;
    releaseObjectUrls();
    try {
      const bytes = await repo.imageBytes(record);
      state.currentCanvas = await bytesToCanvas(bytes);
      await repo.touch(record);
    } catch (e) {
      toast('This card image could not be read.');
      return;
    }
    $('f-rotate').checked = false;
    renderFinalImage();
    const meta = $('final-meta');
    meta.replaceChildren();
    const pairs = [['Name', record.name], ['Type', record.typeLine], ['Game text', record.rulesText]];
    if (record.isCopy) pairs.push(['Copied by', record.sourceCardName || '—']);
    pairs.push(['Saved', formatDate(record.createdAt)]);
    for (const [k, v] of pairs) {
      if (!v) continue;
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      meta.append(dt, dd);
    }
    $('btn-share').hidden = !transfer.share.isAvailable();
    show('final', record.name);
  }

  function currentOutputCanvas() {
    return $('f-rotate').checked ? rotateCanvas(state.currentCanvas) : state.currentCanvas;
  }
  function currentFilename() {
    return `${safeName(state.current.name)}_card_display${$('f-rotate').checked ? '_400x300' : ''}.png`;
  }
  function renderFinalImage() {
    const img = $('final-img');
    img.classList.toggle('landscape', $('f-rotate').checked);
    img.src = currentOutputCanvas().toDataURL('image/png');
  }
  $('f-rotate').addEventListener('change', renderFinalImage);

  async function sendWith(adapter, button) {
    button.disabled = true;
    try {
      const bytes = await canvasToPngBytes(currentOutputCanvas());
      await adapter.send(bytes, currentFilename());
      if (adapter.id === 'download') toast('Downloaded. Open the EZ Sign app and choose the image.');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast(adapter.id === 'share' ? 'Sharing did not work here. Use Download instead.' : 'Download did not start. Press and hold the image to save it.');
    } finally { button.disabled = false; }
  }
  $('btn-share').addEventListener('click', () => sendWith(transfer.share, $('btn-share')));
  $('btn-download').addEventListener('click', () => sendWith(transfer.download, $('btn-download')));

  $('btn-final-back').addEventListener('click', () => openLibrary(state.game));
  let deleteArmed = false;
  $('btn-delete').addEventListener('click', async () => {
    if (!deleteArmed) {
      deleteArmed = true; $('btn-delete').textContent = 'Tap again to delete';
      setTimeout(() => { deleteArmed = false; $('btn-delete').textContent = 'Delete card'; }, 4000);
      return;
    }
    deleteArmed = false; $('btn-delete').textContent = 'Delete card';
    await repo.remove(state.current.id);
    toast('Deleted.');
    openLibrary(state.game);
  });

  // Copy card
  function copyDraft() {
    return { title: $('c-title').value, typeLine: $('c-type').value, rulesText: $('c-rules').value, sourceCardName: $('c-source').value };
  }
  let copyTimer;
  function renderCopyPreview() {
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      const c = buildTextCard(copyDraft());
      $('copy-canvas').getContext('2d').drawImage(c, 0, 0);
    }, 120);
  }
  for (const id of ['c-title', 'c-type', 'c-rules', 'c-source']) $(id).addEventListener('input', renderCopyPreview);

  $('btn-copy').addEventListener('click', async () => {
    $('c-title').value = ''; $('c-type').value = ''; $('c-rules').value = ''; $('c-source').value = '';
    const dl = $('saved-names'); dl.replaceChildren();
    for (const r of await repo.all(state.game)) { const o = document.createElement('option'); o.value = r.name; dl.append(o); }
    show('copy', 'Copy card');
    renderCopyPreview();
    $('c-title').focus();
  });
  $('btn-copy-cancel').addEventListener('click', () => openLibrary(state.game));
  $('btn-copy-save').addEventListener('click', async () => {
    const btn = $('btn-copy-save'); btn.disabled = true;
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const draft = copyDraft();
      const c = buildTextCard(draft);
      const pngBytes = await canvasToPngBytes(c);
      const record = await repo.save({
        game: state.game, name: draft.title || 'Copied card', typeLine: draft.typeLine, rulesText: draft.rulesText,
        pngBytes, isCopy: true, sourceCardName: draft.sourceCardName.trim() || null,
      });
      toast('Saved.');
      openFinal(record);
    } catch (e) {
      toast('Could not save the copy card.');
    } finally { btn.disabled = false; }
  });

  // Settings
  $('btn-settings').addEventListener('click', async () => {
    state.history.push(state.screen);
    $('storage-status').textContent = { encrypted: 'Encrypted in this browser', plain: 'Stored in this browser', memory: 'Not available (this visit only)' }[store.mode];
    $('card-count').textContent = String((await repo.all()).length);
    $('ocr-state').textContent = { idle: 'Loads on first scan', loading: 'Loading', ready: 'Ready, on device', failed: 'Unavailable' }[ocr.state];
    $('offline-state').textContent = navigator.serviceWorker && navigator.serviceWorker.controller ? 'Ready to use offline' : 'Available after the first visit';
    $('app-version').textContent = APP_VERSION + ' web';
    $('btn-delete-all-confirm').hidden = true;
    show('settings', 'Settings');
  });
  $('btn-delete-all').addEventListener('click', () => { $('btn-delete-all-confirm').hidden = false; });
  $('btn-delete-all-confirm').addEventListener('click', async () => {
    await repo.clear();
    $('card-count').textContent = '0';
    $('btn-delete-all-confirm').hidden = true;
    toast('All cards deleted.');
  });

  // Back
  $('btn-back').addEventListener('click', () => {
    switch (state.screen) {
      case 'library': show('home'); break;
      case 'camera': openLibrary(state.game); break;
      case 'review': state.ocrJob++; state.review = null; openLibrary(state.game); break;
      case 'final': case 'copy': openLibrary(state.game); break;
      case 'settings': {
        const prev = state.history.pop() || 'home';
        if (prev === 'home') show('home');
        else if (prev === 'final' && state.current) openFinal(state.current);
        else if (state.game) openLibrary(state.game); else show('home');
        break;
      }
      default: show('home');
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.screen === 'camera') camera.stop();
    else if (!document.hidden && state.screen === 'camera' && !camera.stream) openCamera();
  });

  // Boot
  initStorage().then(() => { if (state.screen === 'library') renderLibrary(); });
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }

  // Exposed for the verification script only.
  window.__cardDisplay = { ditherFourColors, snapToPalette, buildTextCard, preparePhoto, prepareForOcr, inspectImage, parseOcrText, ocr, repo, store, transfer, PALETTE, APP_VERSION };
})();
