/* Card Display — web app.
   Ports the Flutter MVP's ImageProcessor, OcrService parse, SecureCardStore and
   CardRepository to the browser. Everything runs on the device; nothing is uploaded. */
(() => {
  'use strict';

  const APP_VERSION = '0.4.0';

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

  // ---------------------------------------------------------------------------
  // Auto-crop: find the card against its background, straighten it, trim a
  // solid black border, fit to 3:4. From scratch, no OpenCV.
  // ---------------------------------------------------------------------------
  const CARD_W = 900, CARD_H = 1200;
  const DETECT = { width: 480, ring: 0.04, threshold: 40, minArea: 0.15, minRatio: 1.15, maxRatio: 1.65 };
  const TRIM = { dark: 64, share: 0.92, slack: 0.01, min: 0.015, max: 0.12, margin: 0.015 };
  const FIT_MAX_CROP = 0.04;

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  function median(values) {
    values.sort((a, b) => a - b);
    return values[values.length >> 1];
  }

  // 3×3 erode (AND) or dilate (OR) on a 0/1 mask, as two separable passes.
  function morph(mask, w, h, dilate) {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
    const pick = dilate ? (a, b, c) => a | b | c : (a, b, c) => a & b & c;
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) tmp[i] = pick(mask[x > 0 ? i - 1 : i], mask[i], mask[x < w - 1 ? i + 1 : i]);
    }
    for (let y = 0, i = 0; y < h; y++) {
      for (let x = 0; x < w; x++, i++) out[i] = pick(tmp[y > 0 ? i - w : i], tmp[i], tmp[y < h - 1 ? i + w : i]);
    }
    return out;
  }

  // Largest 4-connected component: a label map and the winning label.
  function largestComponent(mask, w, h) {
    const n = w * h, labels = new Int32Array(n), queue = new Int32Array(n);
    let best = 0, bestSize = 0, next = 0;
    for (let s = 0; s < n; s++) {
      if (!mask[s] || labels[s]) continue;
      next++;
      let head = 0, tail = 0;
      queue[tail++] = s; labels[s] = next;
      while (head < tail) {
        const i = queue[head++], x = i % w;
        if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = next; queue[tail++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = next; queue[tail++] = i + 1; }
        if (i >= w && mask[i - w] && !labels[i - w]) { labels[i - w] = next; queue[tail++] = i - w; }
        if (i + w < n && mask[i + w] && !labels[i + w]) { labels[i + w] = next; queue[tail++] = i + w; }
      }
      if (tail > bestSize) { bestSize = tail; best = next; }
    }
    return { labels, label: best, size: bestSize };
  }

  // Component area with its holes filled: everything not reachable from the image edge.
  function filledArea(labels, label, w, h) {
    const n = w * h, seen = new Uint8Array(n), queue = new Int32Array(n);
    let tail = 0;
    const push = i => { if (!seen[i] && labels[i] !== label) { seen[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    for (let head = 0; head < tail; head++) {
      const i = queue[head], x = i % w;
      if (x > 0) push(i - 1);
      if (x < w - 1) push(i + 1);
      if (i >= w) push(i - w);
      if (i + w < n) push(i + w);
    }
    return n - tail;
  }

  function isConvex(q) {
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
      const cross = Math.sign((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]));
      if (!cross || (sign && cross !== sign)) return false;
      sign = cross;
    }
    return true;
  }

  // Corners [tl, tr, br, bl] of the card in source pixels, or null.
  function findCardQuad(img) {
    const { w: iw, h: ih } = sourceSize(img);
    const w = Math.min(DETECT.width, iw), h = Math.max(2, Math.round(ih * (w / iw)));
    const d = drawScaled(img, 0, 0, iw, ih, w, h).getContext('2d').getImageData(0, 0, w, h).data;
    const rx = Math.max(1, Math.round(w * DETECT.ring)), ry = Math.max(1, Math.round(h * DETECT.ring));
    const rs = [], gs = [], bs = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x >= rx && x < w - rx && y >= ry && y < h - ry) continue;
        const p = (y * w + x) * 4;
        rs.push(d[p]); gs.push(d[p + 1]); bs.push(d[p + 2]);
      }
    }
    const br = median(rs), bg = median(gs), bb = median(bs);
    const t2 = DETECT.threshold * DETECT.threshold;
    let mask = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
      const dr = d[p] - br, dg = d[p + 1] - bg, db = d[p + 2] - bb;
      mask[i] = 0.30 * dr * dr + 0.59 * dg * dg + 0.11 * db * db > t2 ? 1 : 0;
    }
    mask = morph(morph(mask, w, h, false), w, h, true); // open
    mask = morph(morph(mask, w, h, true), w, h, false); // close
    const { labels, label, size } = largestComponent(mask, w, h);
    if (!size) return null;
    let tl, tr, brc, bl, minSum = Infinity, maxSum = -Infinity, minDiff = Infinity, maxDiff = -Infinity;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] !== label) continue;
      const x = i % w, y = (i - x) / w;
      // A component cut off by the frame has no trustworthy corners.
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return null;
      if (x + y < minSum) { minSum = x + y; tl = [x, y]; }
      if (x + y > maxSum) { maxSum = x + y; brc = [x, y]; }
      if (x - y > maxDiff) { maxDiff = x - y; tr = [x, y]; }
      if (x - y < minDiff) { minDiff = x - y; bl = [x, y]; }
    }
    if (filledArea(labels, label, w, h) < DETECT.minArea * w * h) return null;
    const quad = [tl, tr, brc, bl];
    if (!isConvex(quad)) return null;
    // Portrait only: the output is portrait, and a landscape blob inside a
    // full-frame card is usually its art box.
    const ratio = (dist(tl, bl) + dist(tr, brc)) / (dist(tl, tr) + dist(bl, brc));
    if (!(ratio >= DETECT.minRatio && ratio <= DETECT.maxRatio)) return null;
    return quad.map(([x, y]) => [(x + 0.5) * (iw / w), (y + 0.5) * (ih / h)]);
  }

  // Homography taking the w×h rectangle onto quad [tl, tr, br, bl] (8×8 Gaussian elimination).
  function rectToQuad(w, h, quad) {
    const rect = [[0, 0], [w, 0], [w, h], [0, h]];
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = rect[i], [u, v] = quad[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (let c = 0; c < 8; c++) {
      let p = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      for (let r = c + 1; r < 8; r++) {
        const f = A[r][c] / A[c][c];
        for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k];
        b[r] -= f * b[c];
      }
    }
    const m = new Array(8);
    for (let r = 7; r >= 0; r--) {
      let s = b[r];
      for (let k = r + 1; k < 8; k++) s -= A[r][k] * m[k];
      m[r] = s / A[r][r];
    }
    return m;
  }

  // Inverse-map every output pixel into the photo and sample bilinearly. The
  // photo is first reduced so the card is at most ~2× the output size.
  function warpQuad(img, quad, dw, dh) {
    const { w: iw, h: ih } = sourceSize(img);
    const s = Math.min(1, (2 * dh) / Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2])));
    const sw = Math.max(1, Math.round(iw * s)), sh = Math.max(1, Math.round(ih * s));
    let src;
    if (s < 1) src = drawScaled(img, 0, 0, iw, ih, sw, sh);
    else { src = makeCanvas(sw, sh); src.getContext('2d').drawImage(img, 0, 0); }
    const sd = src.getContext('2d').getImageData(0, 0, sw, sh).data;
    const m = rectToQuad(dw, dh, quad.map(([x, y]) => [x * (sw / iw), y * (sh / ih)]));
    const out = makeCanvas(dw, dh), g = out.getContext('2d');
    const id = g.createImageData(dw, dh), o = id.data;
    for (let y = 0, p = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++, p += 4) {
        const X = x + 0.5, Y = y + 0.5, z = m[6] * X + m[7] * Y + 1;
        const u = Math.min(sw - 1, Math.max(0, (m[0] * X + m[1] * Y + m[2]) / z - 0.5));
        const v = Math.min(sh - 1, Math.max(0, (m[3] * X + m[4] * Y + m[5]) / z - 0.5));
        const x0 = Math.floor(u), y0 = Math.floor(v), x1 = Math.min(x0 + 1, sw - 1), y1 = Math.min(y0 + 1, sh - 1);
        const fx = u - x0, fy = v - y0;
        const p00 = (y0 * sw + x0) * 4, p10 = (y0 * sw + x1) * 4, p01 = (y1 * sw + x0) * 4, p11 = (y1 * sw + x1) * 4;
        for (let c = 0; c < 3; c++) {
          const top = sd[p00 + c] + (sd[p10 + c] - sd[p00 + c]) * fx;
          const bottom = sd[p01 + c] + (sd[p11 + c] - sd[p01 + c]) * fx;
          o[p + c] = top + (bottom - top) * fy;
        }
        o[p + 3] = 255;
      }
    }
    g.putImageData(id, 0, 0);
    return out;
  }

  // Straightened 900×1200 card canvas, or null when no card is found.
  function detectCard(img) {
    const quad = findCardQuad(img);
    return quad ? warpQuad(img, quad, CARD_W, CARD_H) : null;
  }

  // Remove a solid dark frame. Each side scans inward (allowing ~1% of stray
  // edge lines first), caps at 12%, skips anything under 1.5% (borderless
  // cards), and gives 1.5% back so art that bleeds into the frame is kept.
  function trimBorder(canvas) {
    const w = canvas.width, h = canvas.height;
    const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    const rowDark = new Uint32Array(h), colDark = new Uint32Array(w);
    for (let y = 0, p = 0; y < h; y++) {
      for (let x = 0; x < w; x++, p += 4) {
        if (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2] < TRIM.dark) { rowDark[y]++; colDark[x]++; }
      }
    }
    const side = (n, across, darkAt) => {
      const slack = Math.round(n * TRIM.slack), max = Math.round(n * TRIM.max);
      const border = k => darkAt(k) >= TRIM.share * across;
      let k = 0;
      while (k <= slack && !border(k)) k++;
      if (k > slack) return 0;
      while (k < max && border(k)) k++;
      if (k < n * TRIM.min) return 0;
      return Math.max(0, k - Math.round(n * TRIM.margin));
    };
    const top = side(h, w, k => rowDark[k]), bottom = side(h, w, k => rowDark[h - 1 - k]);
    const left = side(w, h, k => colDark[k]), right = side(w, h, k => colDark[w - 1 - k]);
    if (!top && !bottom && !left && !right) return canvas;
    const out = makeCanvas(w - left - right, h - top - bottom);
    out.getContext('2d').drawImage(canvas, left, top, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  }

  // Cover-fit to 3:4 by cropping the long axis, at most 4%. Any mismatch left
  // after that is letterboxed in white rather than stretched.
  function fitToCard(canvas) {
    const w = canvas.width, h = canvas.height, target = 3 / 4;
    let cw = w, ch = h;
    if (w / h > target) cw = Math.max(Math.round(h * target), Math.round(w * (1 - FIT_MAX_CROP)));
    else ch = Math.max(Math.round(w / target), Math.round(h * (1 - FIT_MAX_CROP)));
    const ow = Math.max(cw, Math.round(ch * target)), oh = Math.max(ch, Math.round(cw / target));
    const out = makeCanvas(ow, oh), g = out.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, ow, oh);
    g.drawImage(canvas, Math.floor((w - cw) / 2), Math.floor((h - ch) / 2), cw, ch, Math.floor((ow - cw) / 2), Math.floor((oh - ch) / 2), cw, ch);
    return out;
  }

  function ditherRegion(img, r) {
    const c = drawScaled(img, r.x, r.y, r.w, r.h, W, H);
    const g = c.getContext('2d');
    g.putImageData(ditherFourColors(g.getImageData(0, 0, W, H)), 0, 0);
    return c;
  }

  // Photo → 300×400 palette image. crop 'auto': detect → trim → fit → dither,
  // falling back to the center crop when no card is found. crop 'full': the
  // center crop (port of ImageProcessor.preparePhoto). Pass `card` to reuse a
  // detectCard result.
  function preparePhoto(img, { crop = 'auto', card } = {}) {
    if (crop === 'auto') {
      const straight = card === undefined ? detectCard(img) : card;
      if (straight) {
        const fit = fitToCard(trimBorder(straight));
        return ditherRegion(fit, { x: 0, y: 0, w: fit.width, h: fit.height });
      }
    }
    return ditherRegion(img, cropRect(img));
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

  function buildTextCard({ title, typeLine, rulesText, sourceCardName, pt }) {
    const hasPt = !!(pt && pt.trim());
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
      if (y > (hasPt ? 356 : 376)) break; // leave the bottom-right corner to P/T
      g.fillText(line, 10, y); y += 18;
    }
    if (hasPt) {
      g.font = `700 14px ${FONT_STACK}`;
      g.textAlign = 'right'; g.textBaseline = 'alphabetic';
      g.fillText(ellipsizeToWidth(g, pt.trim(), 140), 290, 386);
      g.textAlign = 'left';
    }
    g.putImageData(snapToPalette(g.getImageData(0, 0, W, H)), 0, 0);
    return c;
  }

  // ---------------------------------------------------------------------------
  // Copy card merge: start from the copied card, apply the copier's
  // "copy of … except …" clause. Each pattern blanks what it consumed (NUL
  // characters, so later patterns cannot match across it); whatever is left
  // lands in notes as "Except: …" so nothing is lost.
  // ---------------------------------------------------------------------------
  const KEYWORDS = ['first strike', 'double strike', 'flying', 'deathtouch', 'haste', 'hexproof', 'indestructible', 'lifelink', 'menace', 'reach', 'trample', 'vigilance', 'flash', 'defender'];
  const CARD_TYPES = 'artifact|enchantment|creature';
  const COLORS = 'white|blue|black|red|green';
  const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const QUOTED = `["“][^"”]*["”]|‘[^’]*’|'.+?'(?=[\\s,.;]|$)`;
  const LIST_SEP = '\\s*(?:,\\s*and|,|and)\\s*';
  const IT_IS = "\\bit(?:'s| is)";

  const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);
  const signed = n => (n >= 0 ? '+' : '') + n;

  function consume(clause, m) {
    return clause.slice(0, m.index) + '\0'.repeat(m[0].length) + clause.slice(m.index + m[0].length);
  }

  function splitType(typeLine) {
    const m = /\s+[—–-]\s+|\s*[—–]\s*/.exec(typeLine);
    return m ? { left: typeLine.slice(0, m.index).trim(), right: typeLine.slice(m.index + m[0].length).trim() } : { left: typeLine.trim(), right: '' };
  }
  const joinType = (left, right) => (right ? `${left} — ${right}` : left).trim();

  // The text after "except" in the sentence that says "copy of", ending at the
  // first period outside quotes. Empty when there is no such clause.
  function exceptClause(rulesText) {
    const text = rulesText.replace(/\s+/g, ' ').replace(/(\w)’(\w)/g, "$1'$2");
    const copy = text.search(/\bcopy of\b/i);
    if (copy < 0) return '';
    const m = /\bexcept\b/i.exec(text.slice(copy));
    if (!m) return '';
    const start = copy + m.index + m[0].length;
    let closers = '';
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (closers) {
        if (closers.includes(ch) && (ch !== "'" || !/\w/.test(text[i + 1] || ''))) {
          closers = '';
          // `… has "Gain 1 life." When …`: the sentence ended inside the quote.
          if (text[i - 1] === '.' && /^(?:\s+[A-Z]|\s*$)/.test(text.slice(i + 1))) return text.slice(start, i + 1).trim();
        }
        continue;
      }
      if (ch === '"' || ch === '“') closers = '"”';
      else if (ch === '‘') closers = '’';
      else if (ch === "'" && /\s/.test(text[i - 1] || ' ')) closers = "'";
      else if (ch === '.' && (i + 1 === text.length || text[i + 1] === ' ')) return text.slice(start, i).trim();
    }
    return text.slice(start).trim();
  }

  function mergeDraft(target) {
    return { name: target.name || '', typeLine: target.typeLine || '', pt: target.pt || '', abilities: [], keywords: [], color: '', power: 0, toughness: 0, boosted: false };
  }

  const copyPatterns = {
    // has "…" / with '…' (several allowed) → each becomes its own paragraph.
    quoted(clause, d) {
      const re = new RegExp(`\\b(?:has|have|gains?|with)\\s+((?:${QUOTED})(?:${LIST_SEP}(?:${QUOTED}))*)`, 'gi');
      for (const m of clause.matchAll(re)) {
        for (const q of m[1].matchAll(new RegExp(QUOTED, 'g'))) d.abilities.push(q[0].slice(1, -1).trim());
        clause = consume(clause, m);
      }
      return clause;
    },
    // it's named <Name> / with the name <Name> → replaces the name.
    name(clause, d) {
      for (const m of clause.matchAll(/\b(?:it(?:'s| is) named|its name is|with the name)\s+([^,\0]+?)(?=\s*(?:,|\band\b|\0|$))/gi)) {
        d.name = m[1].trim();
        clause = consume(clause, m);
      }
      return clause;
    },
    // it's an artifact/enchantment/creature in addition → card type before the dash.
    cardType(clause, d) {
      const re = new RegExp(`${IT_IS} an? ((?:${CARD_TYPES})(?:\\s+(?:${CARD_TYPES}))*)\\s+in addition(?: to its other (?:\\w+ )?types)?`, 'gi');
      for (const m of clause.matchAll(re)) {
        for (const type of m[1].split(/\s+/)) {
          const { left, right } = splitType(d.typeLine);
          const words = left ? left.split(/\s+/) : [];
          if (words.some(w => w.toLowerCase() === type.toLowerCase())) continue;
          let at = 0;
          while (at < words.length && /^(?:legendary|basic|snow|world)$/i.test(words[at])) at++;
          words.splice(at, 0, capitalize(type.toLowerCase()));
          d.typeLine = joinType(words.join(' '), right);
        }
        clause = consume(clause, m);
      }
      return clause;
    },
    // it's a/an <Word(s)> in addition to its other types → subtypes after the dash.
    subtype(clause, d) {
      for (const m of clause.matchAll(new RegExp(`${IT_IS} an? ([A-Za-z][\\w'-]*(?:\\s+[A-Za-z][\\w'-]*)*?)\\s+in addition to its other (?:\\w+ )?types`, 'gi'))) {
        const { left, right } = splitType(d.typeLine);
        const have = right ? right.split(/\s+/) : [];
        for (const word of m[1].split(/\s+/).map(capitalize)) if (!have.includes(word)) have.push(word);
        d.typeLine = joinType(left, have.join(' '));
        clause = consume(clause, m);
      }
      return clause;
    },
    // it's legendary / it isn't legendary / it's not legendary.
    legendary(clause, d) {
      for (const m of clause.matchAll(/\bit(?:'s| is)(?: (not))? legendary\b|\bit isn't legendary\b/gi)) {
        const remove = !!m[1] || /isn't/i.test(m[0]);
        const plain = d.typeLine.replace(/^legendary\s+/i, '');
        d.typeLine = remove ? plain : 'Legendary ' + plain;
        clause = consume(clause, m);
      }
      return clause;
    },
    // has <keyword>[, <keyword> and <keyword>] → one line each.
    keyword(clause, d) {
      const kw = `(?:${KEYWORDS.join('|')})`;
      for (const m of clause.matchAll(new RegExp(`\\b(?:has|have|gains?)\\s+(${kw}(?:${LIST_SEP}${kw})*)\\b`, 'gi'))) {
        for (const k of m[1].split(new RegExp(LIST_SEP, 'i'))) if (k) d.keywords.push(capitalize(k.toLowerCase()));
        clause = consume(clause, m);
      }
      return clause;
    },
    // gets +N/+N, enters with a/one/two/N (additional) +1/+1 counter(s) → "(+N/+N)" after P/T.
    counters(clause, d) {
      for (const m of clause.matchAll(/\bgets\s+([+-]\d+)\/([+-]\d+)/gi)) {
        d.power += Number(m[1]); d.toughness += Number(m[2]); d.boosted = true;
        clause = consume(clause, m);
      }
      for (const m of clause.matchAll(/\benters(?: the battlefield)? with (an?|one|two|three|four|five|six|seven|eight|nine|ten|\d+)(?: additional)? \+1\/\+1 counters?(?: on it)?/gi)) {
        const n = NUMBER_WORDS[m[1].toLowerCase()] || Number(m[1]);
        d.power += n; d.toughness += n; d.boosted = true;
        clause = consume(clause, m);
      }
      return clause;
    },
    // it's <color>[ and <color>] / it's colorless → "Color: …" line.
    color(clause, d) {
      const re = new RegExp(`${IT_IS} (colorless|(?:${COLORS})(?:${LIST_SEP}(?:${COLORS}))*)( in addition to its other colors)?\\b`, 'gi');
      for (const m of clause.matchAll(re)) {
        d.color = m[1].toLowerCase() + (m[2] || '');
        clause = consume(clause, m);
      }
      return clause;
    },
  };
  const PATTERN_ORDER = ['quoted', 'name', 'cardType', 'subtype', 'legendary', 'keyword', 'counters', 'color'];

  // Unconsumed pieces of the clause, minus connective words.
  function exceptLeftovers(clause) {
    const filler = /^(?:and|also|it|its|has|have|with|that|the|copy)$/i;
    return clause.split(/\0+/)
      .map(s => s.replace(/^[\s,;]+|[\s,;.]+$/g, '').replace(/^(?:and|also)\s+/i, '').trim())
      .filter(s => s && !s.split(/[\s,;]+/).every(w => filler.test(w)))
      .join('; ');
  }

  function mergeCopy(copier, target) {
    const rules = (target.rulesText || '').trim();
    const clause = exceptClause(copier.rulesText || '');
    if (!clause) return { name: target.name || '', typeLine: target.typeLine || '', rulesText: rules, pt: target.pt || '', notes: '' };
    const d = mergeDraft(target);
    let rest = clause;
    for (const key of PATTERN_ORDER) rest = copyPatterns[key](rest, d);
    const notes = exceptLeftovers(rest);
    let rulesText = rules;
    const add = (sep, s) => { rulesText = rulesText ? rulesText + sep + s : s; };
    for (const a of d.abilities) add('\n\n', a);
    for (const k of d.keywords) add('\n', k);
    if (d.color) add('\n', 'Color: ' + d.color);
    if (notes) add('\n\n', 'Except: ' + notes);
    const pt = d.boosted ? `${d.pt} (${signed(d.power)}/${signed(d.toughness)})`.trim() : d.pt;
    return { name: d.name, typeLine: d.typeLine, rulesText, pt, notes };
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
  const PT_LINE = /^\d+\s*\/\s*\d+$/;
  const TYPE_WORDS = ['creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery', 'land', 'unit', 'upgrade', 'event'];

  function parseOcrText(rawText) {
    const lines = rawText.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 1);
    if (!lines.length) return { name: '', typeLine: '', rulesText: '', pt: '', rawText: '' };
    const name = lines[0];
    const ptLine = lines.slice(1).find(line => PT_LINE.test(line));
    const pt = ptLine ? ptLine.replace(/\s+/g, '') : '';
    let typeIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      if (TYPE_WORDS.some(w => lower.includes(w))) { typeIndex = i; break; }
    }
    const typeLine = typeIndex >= 0 ? lines[typeIndex] : '';
    const rulesStart = typeIndex >= 0 ? typeIndex + 1 : 1;
    const rulesText = lines.slice(rulesStart).filter(line => {
      const lower = line.toLowerCase();
      return !PT_LINE.test(line) && !lower.includes('©') && !lower.startsWith('illus.');
    }).join('\n');
    return { name, typeLine, rulesText, pt, rawText };
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
          // Card records are schemaless values keyed by id. Adding optional fields
          // (pt and copiedCardName in 0.4.0) needs no version bump or migration;
          // readers treat a missing field as empty.
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
    async save({ game, name, typeLine, rulesText, pt = '', pngBytes, isCopy = false, sourceCardName = null, copiedCardName = null }) {
      const now = Date.now();
      const record = {
        id: uuid(), game,
        name: name.trim() || 'Untitled card',
        typeLine: typeLine.trim(), rulesText: rulesText.trim(), pt: pt.trim(),
        createdAt: now, updatedAt: now, isCopy, sourceCardName, copiedCardName,
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
  const screens = ['home', 'library', 'camera', 'review', 'final', 'copystep', 'copy', 'settings'];
  const state = { screen: 'home', game: null, review: null, current: null, currentCanvas: null, copy: null, history: [], ocrJob: 0 };

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

  // Per-viewer preferences in localStorage; every access may throw (private mode, blocked storage).
  const prefs = {
    get(key, fallback) {
      try { const v = localStorage.getItem('card_display.' + key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('card_display.' + key, JSON.stringify(value)); } catch (e) { /* not remembered */ }
    },
  };

  // Library thumbnails: 96×128, smoothly downscaled so the dither averages into
  // tones. Cached per record id (as a promise of an object URL) for the session.
  const thumbs = new Map();
  function thumbnailUrl(record) {
    if (!thumbs.has(record.id)) {
      const job = (async () => {
        const full = await bytesToCanvas(await repo.imageBytes(record));
        const small = drawScaled(full, 0, 0, full.width, full.height, 96, 128);
        const blob = await new Promise(r => small.toBlob(r, 'image/png'));
        if (!blob) throw new Error('thumbnail encode failed');
        return URL.createObjectURL(blob);
      })();
      job.catch(() => thumbs.delete(record.id));
      thumbs.set(record.id, job);
    }
    return thumbs.get(record.id);
  }
  function dropThumbs(id) {
    for (const [key, job] of thumbs) {
      if (id && key !== id) continue;
      job.then(url => URL.revokeObjectURL(url), () => {});
      thumbs.delete(key);
    }
  }

  // Home
  for (const tile of document.querySelectorAll('.tile')) {
    tile.addEventListener('click', () => openLibrary(tile.dataset.game));
  }

  async function openLibrary(game) {
    state.game = game;
    state.copy = null;
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
      thumbnailUrl(r).then(url => { thumb.src = url; }, () => { thumb.alt = 'Unreadable'; });
    }
  }
  $('search').addEventListener('input', () => { renderLibrary(); });

  // Sleeve warning, then camera
  $('btn-scan').addEventListener('click', () => { $('sheet').hidden = false; $('btn-sheet-continue').focus(); });
  function closeSheet() {
    $('sheet').hidden = true;
    if (state.copy) state.copy.scanning = false;
  }
  $('btn-sheet-cancel').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', e => { if (e.target === $('sheet')) closeSheet(); });
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
    show('camera', state.copy && state.copy.scanning ? COPY_STEPS[state.copy.step].title : 'Scan card');
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
    if (state.copy && state.copy.scanning) { copyScanned(source); return; }
    toast('Processing photo…', 8000);
    try {
      const quality = inspectImage(source);
      const card = detectCard(source);
      // Both crops are made now so the original photo can be dropped right away.
      const outputs = { full: preparePhoto(source, { crop: 'full' }), auto: card ? preparePhoto(source, { card }) : null };
      // OCR reads the straightened card when there is one.
      const ocrCanvas = prepareForOcr(card || source);
      state.review = { outputs, crop: card ? 'auto' : 'full', warnings: quality.warnings, ocrCanvas };
      $('toast').hidden = true;
      openReview();
    } catch (e) {
      toast('That photo could not be processed.');
    }
  }

  function reviewCanvas() { return state.review.outputs[state.review.crop]; }

  function drawReview() {
    const { outputs, crop } = state.review;
    for (const b of document.querySelectorAll('[data-crop]')) b.setAttribute('aria-pressed', String(b.dataset.crop === crop));
    $('btn-crop-auto').disabled = !outputs.auto;
    $('crop-note').textContent = outputs.auto ? 'Card found and straightened.' : 'No card edge found, so this is the full frame.';
    $('review-canvas').getContext('2d').drawImage(reviewCanvas(), 0, 0);
  }
  for (const b of document.querySelectorAll('[data-crop]')) {
    b.addEventListener('click', () => {
      if (!state.review || b.disabled) return;
      state.review.crop = b.dataset.crop;
      drawReview();
    });
  }

  function openReview() {
    const { warnings } = state.review;
    const warn = $('review-warn');
    if (warnings.length) {
      warn.replaceChildren();
      const h = document.createElement('strong'); h.textContent = 'Check the photo';
      warn.append(h);
      for (const w of warnings) { const p = document.createElement('p'); p.textContent = w; warn.append(p); }
      warn.hidden = false;
    } else warn.hidden = true;
    drawReview();
    $('f-name').value = ''; $('f-type').value = ''; $('f-rules').value = ''; $('f-pt').value = '';
    show('review', 'Review');
    const source = state.review.ocrCanvas;
    runOcr(source, '', parsed => {
      if (state.review) state.review.ocrCanvas = null;
      return fillFields(parsed, { name: 'f-name', typeLine: 'f-type', rulesText: 'f-rules', pt: 'f-pt' });
    });
  }

  // Fill empty fields from OCR, preferring an earlier correction for that name.
  async function fillFields(parsed, ids) {
    const correction = parsed.name ? await repo.correctionFor(state.game, parsed.name) : null;
    for (const [key, id] of Object.entries(ids)) {
      if (!$(id).value.trim()) $(id).value = (correction && correction[key]) || parsed[key] || '';
    }
    if (correction) toast('Filled from your earlier correction.');
  }

  // OCR with progress into the status block whose ids start with `prefix`
  // ('' for review, 'cs-' for the copy steps). apply(parsed) fills the fields.
  async function runOcr(source, prefix, apply) {
    const job = ++state.ocrJob;
    const status = $(prefix + 'ocr-status'), label = $(prefix + 'ocr-label'), pct = $(prefix + 'ocr-pct'), bar = $(prefix + 'ocr-bar');
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
      bar.style.width = '100%'; pct.textContent = '';
      if (!parsed.name && !parsed.typeLine && !parsed.rulesText) {
        label.textContent = 'No text found. Type the card details below.';
        return;
      }
      await apply(parsed);
      label.textContent = 'Text read. Check it and fix anything that is off.';
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
    if (!$('f-pt').value.trim()) $('f-pt').value = correction.pt || '';
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
      const pngBytes = await canvasToPngBytes(reviewCanvas());
      const name = $('f-name').value, typeLine = $('f-type').value, rulesText = $('f-rules').value, pt = $('f-pt').value;
      const record = await repo.save({ game: state.game, name, typeLine, rulesText, pt, pngBytes });
      await repo.saveCorrection(state.game, record.name, { name: record.name, typeLine: record.typeLine, rulesText: record.rulesText, pt: record.pt });
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
    try {
      const bytes = await repo.imageBytes(record);
      state.currentCanvas = await bytesToCanvas(bytes);
      await repo.touch(record);
    } catch (e) {
      toast('This card image could not be read.');
      return;
    }
    $('f-rotate').checked = prefs.get('rotate', false);
    renderFinalImage();
    const meta = $('final-meta');
    meta.replaceChildren();
    const pairs = [['Name', record.name], ['Type', record.typeLine], ['P/T', record.pt], ['Game text', record.rulesText]];
    if (record.isCopy) pairs.push(['Copied by', record.sourceCardName || '—'], ['Copy of', record.copiedCardName]);
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
  $('f-rotate').addEventListener('change', () => { prefs.set('rotate', $('f-rotate').checked); renderFinalImage(); });

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
    dropThumbs(state.current.id);
    toast('Deleted.');
    openLibrary(state.game);
  });

  // Copy card: 1) scan the copying card, 2) scan the card being copied, 3) review the merge.
  const COPY_STEPS = {
    1: { side: 'copier', title: 'Scan the copying card', hint: 'The card whose text makes it a copy of another card.' },
    2: { side: 'target', title: 'Scan the card being copied', hint: 'Its name, type line, game text and P/T are the starting point.' },
  };
  const blankCard = () => ({ name: '', typeLine: '', rulesText: '', pt: '' });
  const CS_FIELDS = { name: 'cs-name', typeLine: 'cs-type', rulesText: 'cs-rules', pt: 'cs-pt' };

  function readCopyStep() {
    const card = state.copy[COPY_STEPS[state.copy.step].side];
    for (const [key, id] of Object.entries(CS_FIELDS)) card[key] = $(id).value;
  }

  function openCopyStep(step) {
    state.copy.step = step;
    const { side, title, hint } = COPY_STEPS[step];
    const card = state.copy[side];
    $('cs-step').textContent = `Step ${step} of 3`;
    $('cs-title').textContent = title;
    $('cs-hint').textContent = hint;
    for (const [key, id] of Object.entries(CS_FIELDS)) $(id).value = card[key];
    $('cs-type-field').hidden = $('cs-pt-field').hidden = side === 'copier';
    $('btn-cs-scan').lastChild.textContent = card.name || card.rulesText ? ' Scan again' : ' Scan card';
    show('copystep', 'Copy card');
  }

  $('btn-copy').addEventListener('click', () => {
    state.copy = { step: 1, copier: blankCard(), target: blankCard(), scanning: false };
    $('cs-ocr-status').hidden = true;
    openCopyStep(1);
  });
  $('btn-cs-scan').addEventListener('click', () => {
    readCopyStep();
    state.copy.scanning = true;
    $('sheet').hidden = false; $('btn-sheet-continue').focus();
  });

  function copyScanned(source) {
    const copy = state.copy;
    copy.scanning = false;
    copy[COPY_STEPS[copy.step].side] = blankCard();
    openCopyStep(copy.step);
    let ocrSource;
    try { ocrSource = prepareForOcr(detectCard(source) || source); } catch (e) { toast('That photo could not be processed.'); return; }
    const step = copy.step;
    runOcr(ocrSource, 'cs-', parsed => {
      if (state.copy !== copy || copy.step !== step || state.screen !== 'copystep') return;
      return fillFields(parsed, CS_FIELDS);
    });
  }

  $('btn-cs-cancel').addEventListener('click', () => openLibrary(state.game));
  $('btn-cs-next').addEventListener('click', async () => {
    state.ocrJob++;
    readCopyStep();
    $('cs-ocr-status').hidden = true;
    if (state.copy.step === 1) { openCopyStep(2); return; }
    const { copier, target } = state.copy;
    const merged = mergeCopy(copier, target);
    $('c-title').value = merged.name; $('c-type').value = merged.typeLine;
    $('c-rules').value = merged.rulesText; $('c-pt').value = merged.pt;
    $('c-source').value = copier.name.trim(); $('c-target').value = target.name.trim();
    $('copy-notes').hidden = !merged.notes;
    show('copy', 'Copy card');
    renderCopyPreview();
  });

  function copyDraft() {
    return { title: $('c-title').value, typeLine: $('c-type').value, rulesText: $('c-rules').value, pt: $('c-pt').value, sourceCardName: $('c-source').value };
  }
  let copyTimer;
  function renderCopyPreview() {
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      const c = buildTextCard(copyDraft());
      $('copy-canvas').getContext('2d').drawImage(c, 0, 0);
    }, 120);
  }
  for (const id of ['c-title', 'c-type', 'c-rules', 'c-pt', 'c-source']) $(id).addEventListener('input', renderCopyPreview);
  $('btn-copy-cancel').addEventListener('click', () => openLibrary(state.game));
  $('btn-copy-save').addEventListener('click', async () => {
    const btn = $('btn-copy-save'); btn.disabled = true;
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const draft = copyDraft();
      const c = buildTextCard(draft);
      const pngBytes = await canvasToPngBytes(c);
      const record = await repo.save({
        game: state.game, name: draft.title || 'Copied card', typeLine: draft.typeLine, rulesText: draft.rulesText, pt: draft.pt,
        pngBytes, isCopy: true, sourceCardName: draft.sourceCardName.trim() || null, copiedCardName: $('c-target').value.trim() || null,
      });
      state.copy = null;
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
    dropThumbs();
    $('card-count').textContent = '0';
    $('btn-delete-all-confirm').hidden = true;
    toast('All cards deleted.');
  });

  // Back
  $('btn-back').addEventListener('click', () => {
    switch (state.screen) {
      case 'library': show('home'); break;
      case 'camera':
        if (state.copy && state.copy.scanning) { state.copy.scanning = false; openCopyStep(state.copy.step); }
        else openLibrary(state.game);
        break;
      case 'review': state.ocrJob++; state.review = null; openLibrary(state.game); break;
      case 'copystep':
        state.ocrJob++;
        if (state.copy && state.copy.step === 2) { readCopyStep(); $('cs-ocr-status').hidden = true; openCopyStep(1); }
        else openLibrary(state.game);
        break;
      case 'copy': if (state.copy) openCopyStep(2); else openLibrary(state.game); break;
      case 'final': openLibrary(state.game); break;
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
  window.__cardDisplay = { ditherFourColors, snapToPalette, buildTextCard, preparePhoto, prepareForOcr, detectCard, findCardQuad, trimBorder, fitToCard, mergeCopy, mergeDraft, copyPatterns, exceptClause, inspectImage, parseOcrText, ocr, repo, store, transfer, prefs, thumbnailUrl, PALETTE, APP_VERSION };
})();
