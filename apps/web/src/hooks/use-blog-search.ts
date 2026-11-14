import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useDebounce } from "@/hooks/use-debounce";
import type { Blog } from "@/types";

const SEARCH_DEBOUNCE_MS = 300;
const CACHE_STALE_TIME_MS = 30_000;

export interface BlogSearchResponse {
  results: Blog[];
  page: number;
  totalPages: number;
  total: number;
  hitsPerPage?: number;
}

async function searchBlog(
  query: string,
  page: number,
  category: string | null,
  signal: AbortSignal
): Promise<BlogSearchResponse> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { results: [], page: 1, totalPages: 0, total: 0 };
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

  if (Array.isArray(data)) {
    return {
      results: data as Blog[],
      page: 1,
      totalPages: 1,
      total: data.length,
    };
  }

  return data as BlogSearchResponse;
}

export function useBlogSearch(initialCategory?: string | null) {
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [category, setCategory] = useState<string | null>(initialCategory ?? null);

  const debouncedQuery = useDebounce(searchQuery, SEARCH_DEBOUNCE_MS);
  const hasQuery = debouncedQuery.trim().length > 0;

  const handleQueryChange = (q: string) => {
    setSearchQuery(q);
    setPage(1); // Reset to page 1 on new search query
  };

  const handleCategoryChange = (cat: string | null) => {
    setCategory(cat);
    setPage(1);
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ["blog-search", debouncedQuery, page, category],
    queryFn: ({ signal }) =>
      searchBlog(debouncedQuery, page, category, signal),
    enabled: hasQuery,
    staleTime: CACHE_STALE_TIME_MS,
  });

  return {
    searchQuery,
    setSearchQuery: handleQueryChange,
    page,
    setPage,
    category,
    setCategory: handleCategoryChange,
    results: data?.results ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 0,
    isSearching: isLoading,
    error,
    hasQuery,
  };
}
