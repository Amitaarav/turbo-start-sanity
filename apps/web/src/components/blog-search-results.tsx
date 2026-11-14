import { BlogCard } from "@/components/blog-card";
import { Button } from "@workspace/ui/components/button";
import type { Blog } from "@/types";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

export interface BlogSearchResultsProps {
  results: Blog[];
  searchQuery: string;
  isSearching: boolean;
  hasQuery: boolean;
  error?: unknown;
  onClear: () => void;
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
}

export function BlogSearchResults({
  results,
  searchQuery,
  isSearching,
  hasQuery,
  error,
  onClear,
  page = 1,
  totalPages = 1,
  onPageChange,
}: Readonly<BlogSearchResultsProps>) {
  if (isSearching) {
    return (
      <div className="flex flex-col items-center justify-center border border-border py-16 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Searching articles…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-border p-8 text-center">
        <p className="text-base text-destructive">
          Search service is temporarily unavailable. Please try again.
        </p>
        <Button className="mt-4" onClick={onClear} size="sm" variant="outline">
          Reset search
        </Button>
      </div>
    );
  }

  if (hasQuery && results.length === 0) {
    return (
      <div className="border border-border p-8 text-center">
        <p className="text-base text-muted-foreground">
          No articles found matching &ldquo;{searchQuery}&rdquo;.
        </p>
        <Button className="mt-4" onClick={onClear} size="sm" variant="outline">
          Clear search
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((blog) => (
          <BlogCard blog={blog} key={blog._id} />
        ))}
      </div>

      {totalPages > 1 && onPageChange && (
        <div className="flex items-center justify-between border-t border-border pt-6">
          <Button
            aria-label="Previous search results page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            size="sm"
            variant="outline"
          >
            <ChevronLeft className="mr-1 size-4" />
            Previous
          </Button>

          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>

          <Button
            aria-label="Next search results page"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            size="sm"
            variant="outline"
          >
            Next
            <ChevronRight className="ml-1 size-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

