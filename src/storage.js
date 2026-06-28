// IndexedDB wrapper — all book data persists here, never needs reprocessing

const DB_NAME    = 'never-forget-v1';
const DB_VERSION = 1;

let _db   = null;
let _open = null; // in-flight openDB promise — prevents concurrent open races

function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_open) return _open;

  _open = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('books')) {
        const books = db.createObjectStore('books', { keyPath: 'id' });
        books.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('chunks')) {
        const chunks = db.createObjectStore('chunks', { keyPath: 'id' });
        chunks.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('chapters')) {
        const chapters = db.createObjectStore('chapters', { keyPath: 'id' });
        chapters.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('knowledge')) {
        db.createObjectStore('knowledge', { keyPath: 'bookId' });
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = (e) => {
      _db   = e.target.result;
      _open = null;

      // If the DB is closed externally (e.g. versionchange from another tab),
      // clear the cached reference so the next call reopens it.
      _db.onversionchange = () => { _db.close(); _db = null; };
      _db.onclose         = () => { _db = null; };

      resolve(_db);
    };

    req.onerror = () => {
      _open = null;
      reject(req.error);
    };

    req.onblocked = () => {
      // Another tab has the DB open with an older version — close it there first.
      console.warn('[storage] IndexedDB upgrade blocked. Close other tabs and reload.');
    };
  });

  return _open;
}

// Synchronous shorthand — only safe to call after openDB() has resolved.
function tx(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

// All CRUD helpers are proper async functions (not the antipattern
// `new Promise(async executor)` which swallows rejections from await).

async function put(storeName, record) {
  await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function get(storeName, key) {
  await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(storeName).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror   = () => reject(req.error);
  });
}

async function getAll(storeName) {
  await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function getAllByIndex(storeName, indexName, value) {
  await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(storeName).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function remove(storeName, key) {
  await openDB();
  return new Promise((resolve, reject) => {
    const req = tx(storeName, 'readwrite').delete(key);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ── High-level API ──────────────────────────────────────────────────────────

export const Storage = {
  init: openDB,

  // Books
  saveBook:   (book)   => put('books', book),
  getBook:    (id)     => get('books', id),
  getAllBooks: ()       => getAll('books'),
  deleteBook: (id)     => remove('books', id),

  // Chunks
  saveChunk:    (chunk)  => put('chunks', chunk),
  getChunks:    (bookId) => getAllByIndex('chunks', 'bookId', bookId),
  deleteChunks: async (bookId) => {
    const chunks = await getAllByIndex('chunks', 'bookId', bookId);
    await Promise.allSettled(chunks.map(c => remove('chunks', c.id)));
  },

  // Chapters
  saveChapter:    (ch)    => put('chapters', ch),
  getChapters:    (bookId) => getAllByIndex('chapters', 'bookId', bookId),
  deleteChapters: async (bookId) => {
    const chs = await getAllByIndex('chapters', 'bookId', bookId);
    await Promise.allSettled(chs.map(c => remove('chapters', c.id)));
  },

  // Knowledge
  saveKnowledge:   (k)      => put('knowledge', k),
  getKnowledge:    (bookId) => get('knowledge', bookId),
  deleteKnowledge: (bookId) => remove('knowledge', bookId),

  // Settings
  saveSetting: (key, value) => put('settings', { key, value }),
  getSetting:  async (key)  => { const r = await get('settings', key); return r?.value ?? null; },

  // Full book delete — uses allSettled so one failure doesn't orphan the rest
  deleteBookAll: async (bookId) => {
    await Promise.allSettled([
      remove('books', bookId),
      Storage.deleteChunks(bookId),
      Storage.deleteChapters(bookId),
      remove('knowledge', bookId),
    ]);
  },

  // Reset all chapter AI results so the book can be reprocessed from scratch
  resetChaptersForReprocess: async (bookId) => {
    const chapters = await Storage.getChapters(bookId);
    await Promise.all(chapters.map(ch =>
      put('chapters', { ...ch, aiProcessed: false, summary: null, aiKnowledge: null })
    ));
  },

  // Delete every book and all associated data; does not touch settings
  clearAllBooks: async () => {
    const books = await getAll('books');
    await Promise.allSettled(books.map(b => Storage.deleteBookAll(b.id)));
  },

  // Wipe all stores including settings — developer nuclear option
  clearAll: async () => {
    await openDB();
    await Promise.allSettled([
      Storage.clearAllBooks(),
      new Promise((resolve, reject) => {
        const req = tx('settings', 'readwrite').clear();
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
      }),
    ]);
  },

  // Export all stores (except settings) as a plain object for download
  exportAll: async () => {
    const [books, chunks, chapters, knowledge] = await Promise.all([
      getAll('books'),
      getAll('chunks'),
      getAll('chapters'),
      getAll('knowledge'),
    ]);
    return { books, chunks, chapters, knowledge, exportedAt: Date.now() };
  },

  // Import records from a JSON export; merges into existing data (put overwrites by key)
  importAll: async (data) => {
    await openDB();
    for (const storeName of ['books', 'chunks', 'chapters', 'knowledge']) {
      if (Array.isArray(data[storeName])) {
        await Promise.allSettled(data[storeName].map(r => put(storeName, r)));
      }
    }
  },
};
