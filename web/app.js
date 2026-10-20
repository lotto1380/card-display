/* Card Display — web app UI. Image work is in pipeline.js, text and OCR in
   ocr.js, storage in storage.js; each attaches one namespace to window and
   loads before this file. Everything runs on the device; nothing is uploaded. */
(() => {
  'use strict';

  const APP_VERSION = '0.4.1';

  const { PALETTE, buildTextCard, bytesToCanvas, canvasToPngBytes, detectCard, ditherFourColors, drawScaled, findCardQuad, fitToCard, inspectImage, makeCanvas, prepareCorner, prepareForOcr, preparePhoto, rotateCanvas, snapToPalette, trimBorder } = window.CDPipeline;
  const { copyPatterns, exceptClause, mergeCopy, mergeDraft, ocr, parseOcrText } = window.CDOcr;
  const { initStorage, repo, store } = window.CDStorage;

  const GAMES = {
    mtg: { label: 'Magic: The Gathering', short: 'MTG' },
    swu: { label: 'Star Wars: Unlimited', short: 'SWU' },
    custom: { label: 'Other game', short: 'Other' },
  };

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
      const ocrCorner = card && card.height > card.width ? prepareCorner(card) : null; // P/T sits bottom-right on portrait cards
      state.review = { outputs, crop: card ? 'auto' : 'full', warnings: quality.warnings, ocrCanvas, ocrCorner };
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
    const { ocrCanvas, ocrCorner } = state.review;
    runOcr(ocrCanvas, ocrCorner, '', parsed => {
      if (state.review) state.review.ocrCanvas = state.review.ocrCorner = null;
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
  async function runOcr(source, corner, prefix, apply) {
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
      const parsed = await ocr.read(source, onProgress, corner);
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
    $('f-rotate').checked = prefs.get('rotate', true); // the 4.2" badge is landscape
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
    let ocrSource, ocrCorner;
    try {
      const card = detectCard(source);
      ocrSource = prepareForOcr(card || source);
      ocrCorner = card && card.height > card.width ? prepareCorner(card) : null;
    } catch (e) { toast('That photo could not be processed.'); return; }
    const step = copy.step;
    runOcr(ocrSource, ocrCorner, 'cs-', parsed => {
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
  window.__cardDisplay = { ditherFourColors, snapToPalette, buildTextCard, preparePhoto, prepareForOcr, prepareCorner, detectCard, findCardQuad, trimBorder, fitToCard, mergeCopy, mergeDraft, copyPatterns, exceptClause, inspectImage, parseOcrText, ocr, repo, store, transfer, prefs, thumbnailUrl, PALETTE, APP_VERSION };
})();
