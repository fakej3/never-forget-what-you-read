// IndexedDB wrapper — all book data persists here, never needs reprocessing

const DB_NAME = 'never-forget-v1';
const DB_VERSION = 1;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // books: top-level record per processed PDF
      if (!db.objectStoreNames.contains('books')) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('createdAt', 'createdAt');
      }

      // chunks: raw text + AI summary per chunk
      if (!db.objectStoreNames.contains('chunks')) {
        const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
        chunks.createIndex('bookId', 'bookId');
      }

      // chapters: detected or synthetic chapter records
      if (!db.objectStoreNames.contains('chapters')) {
        const chapters = db.createObjectStore('chapters', { keyPath: 'id' });
        chapters.createIndex('bookId', 'bookId');
      }

      // knowledge: concepts, principles, quotes, actions, vocab
      if (!db.objectStoreNames.contains('knowledge')) {
        db.createObjectStore('knowledge', { keyPath: 'bookId' });
      }

      // settings: API keys, provider choice
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror  = () => reject(req.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function put(storeName, record) {
  return new Promise(async (resolve, reject) => {
    await openDB();
    const req = tx(storeName, 'readwrite').put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function get(storeName, key) {
  return new Promise(async (resolve, reject) => {
    await openDB();
    const req = tx(storeName).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

function getAll(storeName) {
  return new Promise(async (resolve, reject) => {
    await openDB();
    const req = tx(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function getAllByIndex(storeName, indexName, value) {
  return new Promise(async (resolve, reject) => {
    await openDB();
    const req = tx(storeName).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function remove(storeName, key) {
  return new Promise(async (resolve, reject) => {
    await openDB();
    const req = tx(storeName, 'readwrite').delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── High-level API ──────────────────────────────────────────────────────────

export const Storage = {
  init: openDB,

  // Books
  saveBook:    (book)    => put('books', book),
  getBook:     (id)      => get('books', id),
  getAllBooks:  ()        => getAll('books'),
  deleteBook:  (id)      => remove('books', id),

  // Chunks
  saveChunk:   (chunk)   => put('chunks', chunk),
  getChunks:   (bookId)  => getAllByIndex('chunks', 'bookId', bookId),
  deleteChunks: async (bookId) => {
    const chunks = await getAllByIndex('chunks', 'bookId', bookId);
    await Promise.all(chunks.map(c => remove('chunks', c.id)));
  },

  // Chapters
  saveChapter:  (ch)     => put('chapters', ch),
  getChapters:  (bookId) => getAllByIndex('chapters', 'bookId', bookId),
  deleteChapters: async (bookId) => {
    const chs = await getAllByIndex('chapters', 'bookId', bookId);
    await Promise.all(chs.map(c => remove('chapters', c.id)));
  },

  // Knowledge
  saveKnowledge:  (k)      => put('knowledge', k),
  getKnowledge:   (bookId) => get('knowledge', bookId),
  deleteKnowledge: (bookId) => remove('knowledge', bookId),

  // Settings
  saveSetting: (key, value) => put('settings', { key, value }),
  getSetting:  async (key)  => { const r = await get('settings', key); return r?.value ?? null; },

  // Full book delete
  deleteBookAll: async (bookId) => {
    await Promise.all([
      remove('books', bookId),
      Storage.deleteChunks(bookId),
      Storage.deleteChapters(bookId),
      remove('knowledge', bookId),
    ]);
  },
};
