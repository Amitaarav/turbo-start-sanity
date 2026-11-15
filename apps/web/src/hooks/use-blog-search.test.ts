import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CACHE_TTL_MS,
  searchBlog,
  searchCache,
} from "./use-blog-search";

describe("useBlogSearch - Caching and Zero-ReactQuery Network Layer", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    searchCache.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    searchCache.clear();
  });

  it("works with zero react-query context (no QueryClientProvider needed)", async () => {
    // Verifies the module loads and functions without any QueryClient / QueryClientProvider in the environment
    expect(searchCache).toBeDefined();
    expect(typeof searchBlog).toBe("function");
  });

  it("returns empty results immediately for blank queries without making network calls", async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const controller = new AbortController();
    const result = await searchBlog("   ", 1, null, controller.signal);

    expect(result).toEqual({ results: [], page: 1, totalPages: 0, total: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetches from network on cache miss and stores in in-memory cache", async () => {
    const mockData = {
      results: [{ _id: "post-1", title: "Adaptive Layouts", slug: "adaptive-layouts" }],
      page: 1,
      totalPages: 1,
      total: 1,
      hitsPerPage: 10,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });
    globalThis.fetch = fetchMock;

    const controller = new AbortController();
    const result = await searchBlog("adaptive", 1, null, controller.signal);

    expect(result).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Verify cache entry exists
    const cacheKey = "adaptive::1::";
    expect(searchCache.has(cacheKey)).toBe(true);
    expect(searchCache.get(cacheKey)?.data).toEqual(mockData);
  });

  it("serves repeat queries from in-memory cache with zero network calls", async () => {
    const mockData = {
      results: [{ _id: "post-1", title: "Adaptive Layouts" }],
      page: 1,
      totalPages: 1,
      total: 1,
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });
    globalThis.fetch = fetchMock;

    const controller = new AbortController();

    // Call 1: Cache miss -> network fetch
    const result1 = await searchBlog("adaptive", 1, null, controller.signal);
    expect(result1).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Call 2: Cache hit -> served from in-memory Map, NO network fetch
    const result2 = await searchBlog("adaptive", 1, null, controller.signal);
    expect(result2).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Still 1!

    // Call 3: Another cache hit
    const result3 = await searchBlog("adaptive", 1, null, controller.signal);
    expect(result3).toEqual(mockData);
    expect(fetchMock).toHaveBeenCalledTimes(1); // Still 1!
  });

  it("differentiates cache keys by page number and category", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const page = url.includes("page=2") ? 2 : 1;
      const category = url.includes("category=design") ? "design" : "tech";
      return Promise.resolve({
        ok: true,
        json: async () => ({
          results: [{ _id: `post-${page}-${category}` }],
          page,
          totalPages: 3,
          total: 15,
        }),
      });
    });
    globalThis.fetch = fetchMock;

    const controller = new AbortController();

    // Query page 1, category null
    await searchBlog("test", 1, null, controller.signal);
    // Query page 2, category null (different cache key)
    await searchBlog("test", 2, null, controller.signal);
    // Query page 1, category 'design' (different cache key)
    await searchBlog("test", 1, "design", controller.signal);

    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Calling again with page 2, null should HIT cache
    await searchBlog("test", 2, null, controller.signal);
    expect(fetchMock).toHaveBeenCalledTimes(3); // Unchanged!
  });

  it("expires stale cache entries after CACHE_TTL_MS", async () => {
    const mockData = { results: [], page: 1, totalPages: 0, total: 0 };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    });
    globalThis.fetch = fetchMock;

    const controller = new AbortController();

    // Call 1: Populates cache
    await searchBlog("expiring", 1, null, controller.signal);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Artificially age the cache entry beyond CACHE_TTL_MS
    const cacheKey = "expiring::1::";
    const entry = searchCache.get(cacheKey);
    if (entry) {
      entry.timestamp = Date.now() - (CACHE_TTL_MS + 1000);
    }

    // Call 2: Should detect expired entry and refetch
    await searchBlog("expiring", 1, null, controller.signal);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("passes AbortSignal to fetch for keystroke cancellation", async () => {
    let receivedSignal: AbortSignal | undefined;
    globalThis.fetch = vi.fn().mockImplementation((_url, options?: RequestInit) => {
      receivedSignal = options?.signal as AbortSignal;
      return Promise.resolve({
        ok: true,
        json: async () => ({ results: [], page: 1, totalPages: 0, total: 0 }),
      });
    });

    const controller = new AbortController();
    await searchBlog("cancel-test", 1, null, controller.signal);

    expect(receivedSignal).toBe(controller.signal);
  });
});

