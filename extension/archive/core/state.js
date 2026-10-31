// Persistent job state in IndexedDB (extension origin, kept across browser restarts).
//
// Stores:
//   jobs     {id, username, userId, options, status, progress, createdAt, updatedAt, error}
//   records  key [username, category, pk] -> normalized post/story record (also marks "done")
//   blobs    key [username, name] -> JSON-able values (profile, comments, people lists, ...)

const DB_NAME = 'gram-archiver';
const DB_VERSION = 1;

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('jobs')) {
        const jobs = db.createObjectStore('jobs', { keyPath: 'id' });
        jobs.createIndex('username', 'username');
        jobs.createIndex('status', 'status');
      }
      if (!db.objectStoreNames.contains('records')) {
        const records = db.createObjectStore('records', { keyPath: ['username', 'category', 'pk'] });
        records.createIndex('username', 'username');
        records.createIndex('username_category', ['username', 'category']);
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: ['username', 'name'] });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; }, reject);
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const req2p = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

// ---- jobs ----------------------------------------------------------------------------

export function saveJob(job) {
  job.updatedAt = Date.now();
  return tx('jobs', 'readwrite', (s) => req2p(s.put(job)));
}

export function getJob(id) {
  return tx('jobs', 'readonly', (s) => req2p(s.get(id)));
}

export async function listJobs() {
  const all = await tx('jobs', 'readonly', (s) => req2p(s.getAll()));
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function deleteJob(id) {
  return tx('jobs', 'readwrite', (s) => req2p(s.delete(id)));
}

// ---- records -------------------------------------------------------------------------

export function putRecord(record) {
  return tx('records', 'readwrite', (s) => req2p(s.put(record)));
}

export async function hasRecord(username, category, pk) {
  const key = await tx('records', 'readonly', (s) => req2p(s.getKey([username, category, String(pk)])));
  return key !== undefined;
}

export function getRecords(username, category) {
  return tx('records', 'readonly', (s) => req2p(s.index('username_category').getAll([username, category])));
}

export function countRecords(username) {
  return tx('records', 'readonly', (s) => req2p(s.index('username').count(username)));
}

// ---- named values --------------------------------------------------------------------

export function putValue(username, name, value) {
  return tx('blobs', 'readwrite', (s) => req2p(s.put({ username, name, value })));
}

export async function getValue(username, name) {
  const row = await tx('blobs', 'readonly', (s) => req2p(s.get([username, name])));
  return row?.value;
}

export async function listValueNames(username) {
  const keys = await tx('blobs', 'readonly', (s) => req2p(s.getAllKeys(IDBKeyRange.bound([username, ''], [username, '￿']))));
  return keys.map((k) => k[1]);
}

/** Remove everything stored for a username (records, values and jobs). */
export async function forgetUsername(username) {
  await tx('records', 'readwrite', (s) => new Promise((resolve, reject) => {
    const r = s.index('username').openKeyCursor(IDBKeyRange.only(username));
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return resolve();
      s.delete(c.primaryKey);
      c.continue();
    };
    r.onerror = () => reject(r.error);
  }));
  await tx('blobs', 'readwrite', (s) => req2p(s.delete(IDBKeyRange.bound([username, ''], [username, '￿']))));
  const jobs = await listJobs();
  for (const j of jobs.filter((x) => x.username === username)) await deleteJob(j.id);
}

/** Usernames that have something archived, with counts. */
export async function archivedUsernames() {
  const names = new Map();
  await tx('records', 'readonly', (s) => new Promise((resolve, reject) => {
    const r = s.index('username').openKeyCursor();
    r.onsuccess = () => {
      const c = r.result;
      if (!c) return resolve();
      names.set(c.key, (names.get(c.key) || 0) + 1);
      c.continue();
    };
    r.onerror = () => reject(r.error);
  }));
  return [...names.entries()].map(([username, items]) => ({ username, items }));
}
