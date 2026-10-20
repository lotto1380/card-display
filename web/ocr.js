/* Card Display — text: copy-card merge, OCR parse, and the Tesseract.js wrapper
   (vendored, on device). Port of the Flutter OcrService parse. */
(() => {
  'use strict';

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

  // ---------------------------------------------------------------------------
  // OCR (port of OcrService._parse; recognition by Tesseract.js, on device)
  // ---------------------------------------------------------------------------
  const PT_LINE = /^\d+\s*\/\s*\d+$/;
  const TYPE_WORDS = ['creature', 'artifact', 'enchantment', 'planeswalker', 'instant', 'sorcery', 'land', 'unit', 'upgrade', 'event'];

  // OCR often reads the slash in "2/2" as 1, l, I, | or \. That reading is
  // only trusted on the last line, and only when the line is that short.
  const PT_LENIENT = /^(\d{1,2})\s*[\/1lI|\\]\s*(\d{1,2})$/;
  const ocrLines = text => text.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 1);

  // { pt, index } from lines[from…]: the first strict match on any line, else a
  // lenient match on the last line. index is -1 when nothing matched.
  function findPt(lines, from = 0) {
    for (let i = from; i < lines.length; i++) if (PT_LINE.test(lines[i])) return { pt: lines[i].replace(/\s+/g, ''), index: i };
    const last = lines.length - 1, m = last >= from && lines[last].length <= 5 ? PT_LENIENT.exec(lines[last]) : null;
    return m ? { pt: `${m[1]}/${m[2]}`, index: last } : { pt: '', index: -1 };
  }

  function parseOcrText(rawText) {
    const lines = ocrLines(rawText);
    if (!lines.length) return { name: '', typeLine: '', rulesText: '', pt: '', rawText: '' };
    const name = lines[0];
    const { pt, index: ptIndex } = findPt(lines, 1);
    let typeIndex = -1;
    for (let i = 1; i < lines.length; i++) {
      const lower = lines[i].toLowerCase();
      if (TYPE_WORDS.some(w => lower.includes(w))) { typeIndex = i; break; }
    }
    const typeLine = typeIndex >= 0 ? lines[typeIndex] : '';
    const rulesStart = typeIndex >= 0 ? typeIndex + 1 : 1;
    const rulesText = lines.map((line, i) => ({ line, i })).slice(rulesStart).filter(({ line, i }) => {
      const lower = line.toLowerCase();
      return i !== ptIndex && !PT_LINE.test(line) && !lower.includes('©') && !lower.startsWith('illus.');
    }).map(({ line }) => line).join('\n');
    return { name, typeLine, rulesText, pt, rawText };
  }

  const ocr = {
    worker: null, loading: null, state: 'idle', // idle | loading | ready | failed
    progress: null, // progress callback of the job that is running now
    chain: Promise.resolve(),
    // One job at a time on the worker, so the corner pass's page-segmentation
    // mode can never leak into another recognize call.
    exclusive(fn) {
      const run = this.chain.then(fn, fn);
      this.chain = run.catch(() => {});
      return run;
    },
    async ensureScript() {
      if (window.Tesseract) return;
      await new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/tesseract/tesseract.min.js';
        s.onload = resolve; s.onerror = () => reject(new Error('Could not load the text recognizer.'));
        document.head.append(s);
      });
    },
    async ensureWorker() {
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
          logger: m => this.progress && this.progress(m),
          errorHandler: () => {},
        });
        this.worker = worker; this.state = 'ready';
        return worker;
      })().catch(err => { this.state = 'failed'; this.loading = null; throw err; });
      return this.loading;
    },
    // Main pass on the card; with `corner` (prepareCorner output) a second,
    // single-line pass whose P/T wins over the main pass. parsed.cornerMs
    // records how long that pass took.
    async read(canvas, onProgress, corner) {
      this.progress = onProgress || null;
      const worker = await this.ensureWorker();
      return this.exclusive(async () => {
        this.progress = onProgress || null;
        try {
          const result = await worker.recognize(canvas);
          const parsed = parseOcrText(result.data.text || '');
          if (corner) {
            this.progress = null;
            const started = performance.now();
            const pt = await this.cornerPt(worker, corner);
            parsed.cornerMs = Math.round(performance.now() - started);
            if (pt) parsed.pt = pt;
          }
          return parsed;
        } finally { this.progress = null; }
      });
    },
    async readCorner(corner) {
      const worker = await this.ensureWorker();
      return this.exclusive(() => this.cornerPt(worker, corner));
    },
    async cornerPt(worker, corner) {
      await worker.setParameters({ tessedit_pageseg_mode: '7' }); // single line
      try {
        const result = await worker.recognize(corner);
        // Drop stray marks at either end of the line (the frame edge reads as } ] |).
        const lines = ocrLines(result.data.text || '').map(l => l.replace(/^[^\dA-Za-z]+|[^\dA-Za-z]+$/g, ''));
        return findPt(lines).pt;
      } finally {
        await worker.setParameters({ tessedit_pageseg_mode: '6' }); // Tesseract.js default (single block)
      }
    },
  };

  window.CDOcr = { parseOcrText, ocr, mergeCopy, mergeDraft, copyPatterns, exceptClause };
})();
