/* Card Display — image pipeline: the output contract (palette, dithering),
   card detection, border trim, 3:4 fit, OCR image prep, and the text-only card.
   Port of the Flutter ImageProcessor plus the web-only auto-crop. Loads first. */
(() => {
  'use strict';

  // ---------------------------------------------------------------------------
  // Output contract
  // ---------------------------------------------------------------------------
  const W = 300, H = 400;
  const PALETTE = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [255, 255, 0]];

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
  const DETECT = { width: 480, ring: 0.04, threshold: 40, minArea: 0.15, minRatio: 1.15, maxRatio: 1.65, minBlob: 0.0002, maxOthers: 3 };
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

  // Largest 4-connected component: a label map and the winning label, plus the
  // number of other blobs of at least minOther pixels that stay clear of the
  // image edge (text and symbols on a card face; a table around a card has few).
  function largestComponent(mask, w, h, minOther = Infinity) {
    const n = w * h, labels = new Int32Array(n), queue = new Int32Array(n);
    let best = 0, bestSize = 0, next = 0, inner = 0;
    for (let s = 0; s < n; s++) {
      if (!mask[s] || labels[s]) continue;
      next++;
      let head = 0, tail = 0, edge = false;
      queue[tail++] = s; labels[s] = next;
      while (head < tail) {
        const i = queue[head++], x = i % w;
        if (x === 0 || x === w - 1 || i < w || i >= n - w) edge = true;
        if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = next; queue[tail++] = i - 1; }
        if (x < w - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = next; queue[tail++] = i + 1; }
        if (i >= w && mask[i - w] && !labels[i - w]) { labels[i - w] = next; queue[tail++] = i - w; }
        if (i + w < n && mask[i + w] && !labels[i + w]) { labels[i + w] = next; queue[tail++] = i + w; }
      }
      if (tail >= minOther && !edge) inner++;
      if (tail > bestSize) { bestSize = tail; best = next; }
    }
    if (bestSize >= minOther) inner--; // the winner is not an "other" blob (edge-touching winners are rejected anyway)
    return { labels, label: best, size: bestSize, others: Math.max(0, inner) };
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

  // { corners: [tl, tr, br, bl] in source pixels, landscape }, or null.
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
    const { labels, label, size, others } = largestComponent(mask, w, h, Math.round(DETECT.minBlob * w * h));
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
    // Long side over short side, in either orientation.
    const ratio = (dist(tl, bl) + dist(tr, brc)) / (dist(tl, tr) + dist(bl, brc));
    const landscape = ratio < 1, aspect = landscape ? 1 / ratio : ratio;
    if (!(aspect >= DETECT.minRatio && aspect <= DETECT.maxRatio)) return null;
    // A landscape blob with text and symbols around it is most likely the art
    // box of a card that fills the frame, not a landscape card on a table.
    if (landscape && others >= DETECT.maxOthers) return null;
    return { corners: quad.map(([x, y]) => [(x + 0.5) * (iw / w), (y + 0.5) * (ih / h)]), landscape, others };
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
    const longSide = Math.max(dist(quad[0], quad[3]), dist(quad[1], quad[2]), dist(quad[0], quad[1]), dist(quad[3], quad[2]));
    const s = Math.min(1, (2 * Math.max(dw, dh)) / longSide);
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

  // Straightened, upright card canvas: 900×1200 for a portrait card, 1200×900
  // for a landscape one (SWU leaders and bases). null when no card is found.
  function detectCard(img) {
    const found = findCardQuad(img);
    if (!found) return null;
    return found.landscape ? warpQuad(img, found.corners, CARD_H, CARD_W) : warpQuad(img, found.corners, CARD_W, CARD_H);
  }

  // 90° counterclockwise: the card's top-left ends up bottom-left.
  function rotateCounterclockwise(src) {
    const c = makeCanvas(src.height, src.width), g = c.getContext('2d');
    g.translate(0, c.height); g.rotate(-Math.PI / 2);
    g.drawImage(src, 0, 0);
    return c;
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
        // A landscape card is trimmed upright, then turned counterclockwise into
        // portrait; the Rotate 90° export turns it back for a landscape badge.
        let trimmed = trimBorder(straight);
        if (trimmed.width > trimmed.height) trimmed = rotateCounterclockwise(trimmed);
        const fit = fitToCard(trimmed);
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
    return grayStretch(drawScaled(img, r.x, r.y, r.w, r.h, dw, dh));
  }

  // P/T corner of a straightened portrait card: bottom 12%, right 35%, scaled
  // 2× with smoothing, for a single-line OCR pass. Taken from the border-trimmed
  // card, since a black frame in the crop reads as stray marks.
  function prepareCorner(straight) {
    const card = trimBorder(straight);
    const x = Math.round(card.width * 0.65), y = Math.round(card.height * 0.88);
    const w = card.width - x, h = card.height - y;
    const c = makeCanvas(w * 2, h * 2), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(card, x, y, w, h, 0, 0, w * 2, h * 2);
    return grayStretch(c);
  }

  // Grayscale and stretch contrast to the full 0–255 range, in place.
  function grayStretch(c) {
    const dw = c.width, dh = c.height;
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

  window.CDPipeline = { W, H, PALETTE, ditherFourColors, snapToPalette, makeCanvas, drawScaled, inspectImage, detectCard, findCardQuad, trimBorder, fitToCard, preparePhoto, prepareForOcr, prepareCorner, buildTextCard, rotateCanvas, canvasToPngBytes, bytesToCanvas };
})();
