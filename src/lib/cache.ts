// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
/* Shared browser cache for short-lived API responses. */
export const PUBLIC_STATS_CACHE_TTL_MS = 15 * 60 * 1000;

export const LPSCache = (() => {
  const memory = new Map();
  const memoryOnly = new Map();
  const inflight = new Map();
  const prefix = "lps_cache_";
  const MAX_MEMORY_ONLY_ENTRIES = 100;

  function readEntry(key, maxAge = 0) {
    const now = Date.now();
    const memoryEntry = memory.get(key);
    if (memoryEntry && memoryEntry.expiresAt > now) return { hit: true, value: memoryEntry.value };

    try {
      const stored = JSON.parse(sessionStorage.getItem(prefix + key) || "null");
      if (stored && stored.expiresAt > now) {
        memory.set(key, stored);
        return { hit: true, value: stored.value };
      }
      if (stored && maxAge > 0 && stored.expiresAt + maxAge > now) return { hit: true, value: stored.value };
    } catch (error) {
      return { hit: false, value: null };
    }
    return { hit: false, value: null };
  }

  function read(key, maxAge = 0) {
    return readEntry(key, maxAge).value;
  }

  function write(key, value, ttl) {
    const entry = { value, expiresAt: Date.now() + ttl };
    memory.set(key, entry);
    try {
      sessionStorage.setItem(prefix + key, JSON.stringify(entry));
    } catch (error) {
      // Private browsing or storage limits must not break live requests.
    }
    return value;
  }

  function deleteMemoryOnly(key) {
    const entry = memoryOnly.get(key);
    if (entry?.timer) clearTimeout(entry.timer);
    memoryOnly.delete(key);
  }

  function remove(key) {
    memory.delete(key);
    deleteMemoryOnly(key);
    try { sessionStorage.removeItem(prefix + key); } catch (error) { /* Ignore unavailable storage. */ }
  }

  function clear(prefixToClear = "") {
    [...memory.keys()]
      .filter((key) => key.indexOf(prefixToClear) === 0)
      .forEach((key) => memory.delete(key));
    [...memoryOnly.keys()]
      .filter((key) => key.indexOf(prefixToClear) === 0)
      .forEach(deleteMemoryOnly);
    try {
      Object.keys(sessionStorage)
        .filter((key) => key.indexOf(prefix + prefixToClear) === 0)
        .forEach((key) => sessionStorage.removeItem(key));
    } catch (error) {
      // Memory cache is still cleared when storage is unavailable.
    }
  }

  function getOrLoad(key, loader, ttl, staleAge = 0) {
    const cached = readEntry(key);
    if (cached.hit) return Promise.resolve(cached.value);
    if (inflight.has(key)) return inflight.get(key);

    const request = Promise.resolve()
      .then(loader)
      .then((value) => write(key, value, ttl))
      .catch((error) => {
        const stale = readEntry(key, staleAge);
        if (stale.hit) return stale.value;
        throw error;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
  }

  function getOrLoadMemory(key, loader, ttl) {
    const cached = memoryOnly.get(key);
    if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);
    deleteMemoryOnly(key);
    if (inflight.has(key)) return inflight.get(key);

    const request = Promise.resolve()
      .then(loader)
      .then((value) => {
        const cacheEntry = { value, expiresAt: Date.now() + ttl };
        cacheEntry.timer = setTimeout(() => {
          if (memoryOnly.get(key) === cacheEntry) memoryOnly.delete(key);
        }, ttl);
        memoryOnly.set(key, cacheEntry);
        for (const [entryKey, existingEntry] of memoryOnly) {
          if (existingEntry.expiresAt <= Date.now()) deleteMemoryOnly(entryKey);
        }
        while (memoryOnly.size > MAX_MEMORY_ONLY_ENTRIES) {
          deleteMemoryOnly(memoryOnly.keys().next().value);
        }
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
  }

  return { read, write, remove, clear, getOrLoad, getOrLoadMemory };
})();
