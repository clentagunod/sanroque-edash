import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LPSCache } from './cache';

describe('LPSCache', () => {
  beforeEach(() => {
    LPSCache.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    LPSCache.clear();
  });

  it('caches null values instead of reloading absent documents', async () => {
    const loader = vi.fn().mockResolvedValue(null);

    await expect(LPSCache.getOrLoad('missing-public-document', loader, 60_000)).resolves.toBeNull();
    await expect(LPSCache.getOrLoad('missing-public-document', loader, 60_000)).resolves.toBeNull();

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('deduplicates concurrent memory-only loads without persisting the value', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const loader = vi.fn().mockResolvedValue({ guardian: 'Private data' });

    const [first, second] = await Promise.all([
      LPSCache.getOrLoadMemory('parent_learner_lookup_test', loader, 60_000),
      LPSCache.getOrLoadMemory('parent_learner_lookup_test', loader, 60_000),
    ]);

    expect(first).toEqual({ guardian: 'Private data' });
    expect(second).toBe(first);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('reloads a memory-only entry after its TTL expires', async () => {
    vi.useFakeTimers();
    const loader = vi.fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second');

    await expect(LPSCache.getOrLoadMemory('parent_learner_lookup_ttl', loader, 60_000)).resolves.toBe('first');
    vi.advanceTimersByTime(60_001);
    await expect(LPSCache.getOrLoadMemory('parent_learner_lookup_ttl', loader, 60_000)).resolves.toBe('second');

    expect(loader).toHaveBeenCalledTimes(2);
  });
});
