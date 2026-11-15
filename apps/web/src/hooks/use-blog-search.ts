import { useCallback, useEffect, useRef, useState } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import type { Blog } from "@/types";

const SEARCH_DEBOUNCE_MS = 300;
export const CACHE_TTL_MS = 30_000;

export interface BlogSearchResponse {
  results: Blog[];
  page: number;
  totalPages: number;
  total: number;
  hitsPerPage?: number;
}

// In-memory cache for search queries
export const searchCache = new Map<string, { data: BlogSearchResponse; timestamp: number }>();

export async function searchBlog(
  query: string,
  page: number,
  category: string | null,
  signal: AbortSignal
): Promise<BlogSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [], page: 1, totalPages: 0, total: 0 };
  }

  const cacheKey = `${trimmed}::${page}::${category || ""}`;
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const params = new URLSearchParams({
    q: trimmed,
    page: String(page),
  });

  if (category && category !== "") {
    params.set("category", category);
  }

  const response = await fetch(`/api/blog/search?${params.toString()}`, {
    signal,
  });

  if (!response.ok) {
    throw new Error("Failed to search");
  }

  const data = await response.json();

  let formatted: BlogSearchResponse;
  if (Array.isArray(data)) {
    formatted = {
      results: data as Blog[],
      page: 1,
      totalPages: 1,
      total: data.length,
    };
  } else {
    formatted = data as BlogSearchResponse;
  }

  searchCache.set(cacheKey, { data: formatted, timestamp: Date.now() });
  return formatted;
}

export function useBlogSearch(initialCategory?: string | null) {
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<string | null>(initialCategory ?? null);

  const [results, setResults] = useState<Blog[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const debouncedQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);
  const hasQuery = debouncedQuery.trim().length > 0;

  const handleQueryChange = useCallback((q: string) => {
    setSearchQuery(q);
    setPage(1);
  }, []);

  const handleCategoryChange = useCallback((cat: string | null) => {
    setCategory(cat);
    setPage(1);
  }, []);

  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!hasQuery) {
      setResults([]);
      setTotal(0);
      setTotalPages(0);
      setIsSearching(false);
      setError(null);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsSearching(true);
    setError(null);

    searchBlog(debouncedQuery, page, category, controller.signal)
      .then((data) => {
        setResults(data.results);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setIsSearching(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        setError(err instanceof Error ? err : new Error("Failed to search"));
        setIsSearching(false);
      });

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, page, category, hasQuery]);

  return {
    searchQuery,
    setSearchQuery: handleQueryChange,
    page,
    setPage,
    category,
    setCategory: handleCategoryChange,
    results,
    total,
    totalPages,
    isSearching,
    error,
    hasQuery,
  };
}
