// @ts-nocheck -- ported from the original site; behavior preserved, not yet fully typed.
/* Shared browser cache for short-lived Google Sheets responses. */
export const LPSCache = (() => {
  const memory = new Map();
  const inflight = new Map();
  const prefix = "lps_cache_";

  function read(key, maxAge = 0) {
    const now = Date.now();
    const memoryEntry = memory.get(key);
    if (memoryEntry && memoryEntry.expiresAt > now) return memoryEntry.value;

    try {
      const stored = JSON.parse(sessionStorage.getItem(prefix + key) || "null");
      if (stored && stored.expiresAt > now) {
        memory.set(key, stored);
        return stored.value;
      }
      if (stored && maxAge > 0 && stored.expiresAt + maxAge > now) return stored.value;
    } catch (error) {
      return null;
    }
    return null;
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

  function remove(key) {
    memory.delete(key);
    try { sessionStorage.removeItem(prefix + key); } catch (error) { /* Ignore unavailable storage. */ }
  }

  function clear(prefixToClear = "") {
    [...memory.keys()]
      .filter((key) => key.indexOf(prefixToClear) === 0)
      .forEach((key) => memory.delete(key));
    try {
      Object.keys(sessionStorage)
        .filter((key) => key.indexOf(prefix + prefixToClear) === 0)
        .forEach((key) => sessionStorage.removeItem(key));
    } catch (error) {
      // Memory cache is still cleared when storage is unavailable.
    }
  }

  function getOrLoad(key, loader, ttl, staleAge = 0) {
    const cached = read(key);
    if (cached !== null) return Promise.resolve(cached);
    if (inflight.has(key)) return inflight.get(key);

    const request = Promise.resolve()
      .then(loader)
      .then((value) => write(key, value, ttl))
      .catch((error) => {
        const stale = read(key, staleAge);
        if (stale !== null) return stale;
        throw error;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
  }

  return { read, write, remove, clear, getOrLoad };
})();
