/* Card Display — storage: IndexedDB + AES-GCM with a non-extractable key.
   Port of the Flutter SecureCardStore and CardRepository. */
(() => {
  'use strict';

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

  window.CDStorage = { store, repo, initStorage };
})();
