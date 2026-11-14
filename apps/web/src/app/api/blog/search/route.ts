import { Logger } from "@workspace/logger";
import { type NextRequest, NextResponse } from "next/server";
import { getAlgoliaSearchClient } from "@/lib/algolia";
import { ALGOLIA_BLOG_INDEX } from "@/lib/algolia-constants";
import { RateLimiter, getClientIp } from "@/lib/rate-limit";

const logger = new Logger("BlogSearchAPI");

const searchRateLimiter = new RateLimiter({
  maxRequests: 60,
  windowMs: 60 * 1000,
});

const MAX_QUERY_LENGTH = 100;
const MAX_CATEGORY_LENGTH = 50;
const MAX_PAGE = 100;
const HITS_PER_PAGE = 10;

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimit = searchRateLimiter.check(ip);

  const rateLimitHeaders = {
    "X-RateLimit-Limit": String(rateLimit.limit),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(rateLimit.reset),
  };

  if (!rateLimit.success) {
    logger.warn("Search rate limit exceeded", { ip });
    return NextResponse.json(
      { error: "Too many search requests. Please slow down." },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders,
          "Retry-After": String(
            Math.max(1, rateLimit.reset - Math.floor(Date.now() / 1000))
          ),
        },
      }
    );
  }

  const { searchParams } = new URL(request.url);
  const rawQuery = searchParams.get("q") ?? "";
  const rawPage = searchParams.get("page") ?? "1";
  const rawCategory = searchParams.get("category");
  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  const pageParsed = Number.parseInt(rawPage, 10);
  const page = Number.isFinite(pageParsed)
    ? Math.min(Math.max(1, pageParsed), MAX_PAGE)
    : 1;

  const category = rawCategory
    ? rawCategory.trim().slice(0, MAX_CATEGORY_LENGTH)
    : null;

  if (!query) {
    return NextResponse.json(
      {
        results: [],
        page: 1,
        totalPages: 0,
        total: 0,
      },
      { headers: rateLimitHeaders }
    );
  }

  const algolia = getAlgoliaSearchClient();
  if (!algolia) {
    logger.error("Algolia search credentials missing or unconfigured");
    return NextResponse.json(
      {
        error: "Search service is temporarily unavailable",
        results: [],
        page: 1,
        totalPages: 0,
        total: 0,
      },
      { status: 503, headers: rateLimitHeaders }
    );
  }

  try {
    const pageIndex = page - 1; // Algolia pagination is 0-indexed
    const facetFilters = category ? [`category:${category}`] : undefined;

    const response = await algolia.search({
      requests: [
        {
          indexName: ALGOLIA_BLOG_INDEX,
          query,
          page: pageIndex,
          hitsPerPage: HITS_PER_PAGE,
          facetFilters,
        },
      ],
    });

    const firstResult = response.results[0] as
      | {
          hits?: Array<Record<string, unknown>>;
          nbHits?: number;
          nbPages?: number;
          page?: number;
        }
      | undefined;

    const hits = firstResult?.hits ?? [];
    const totalHits = firstResult?.nbHits ?? 0;
    const totalPages = firstResult?.nbPages ?? 0;

    const blogs = hits.map((hit) => {
      const slugRaw = typeof hit.slug === "string" ? hit.slug : "";
      const slug = slugRaw
        ? slugRaw.startsWith("/")
          ? slugRaw
          : `/blog/${slugRaw}`
        : "#";

      const authorName =
        typeof hit.authorName === "string" ? hit.authorName : null;
      const authorPosition =
        typeof hit.authorPosition === "string" ? hit.authorPosition : null;
      const imageUrl =
        typeof hit.imageUrl === "string" ? hit.imageUrl : null;
      const imageAlt =
        typeof hit.imageAlt === "string" ? hit.imageAlt : null;

      return {
        _id: String(hit.objectID ?? ""),
        title: typeof hit.title === "string" ? hit.title : "",
        description:
          typeof hit.description === "string" ? hit.description : "",
        slug,
        category: typeof hit.category === "string" ? hit.category : null,
        publishedAt:
          typeof hit.publishedAt === "string" ? hit.publishedAt : null,
        featured: Boolean(hit.featured),
        authors: authorName
          ? {
              name: authorName,
              position: authorPosition,
              image: null,
            }
          : null,
        image: imageUrl
          ? {
              id: String(hit.objectID ?? ""),
              url: imageUrl,
              alt: imageAlt ?? (hit.title as string) ?? "Blog image",
            }
          : null,
      };
    });

    return NextResponse.json(
      {
        results: blogs,
        page,
        totalPages,
        total: totalHits,
        hitsPerPage: HITS_PER_PAGE,
      },
      {
        headers: {
          ...rateLimitHeaders,
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (error) {
    logger.error("Algolia search request failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      {
        error: "Search service is temporarily unavailable",
        results: [],
        page: 1,
        totalPages: 0,
        total: 0,
      },
      { status: 503, headers: rateLimitHeaders }
    );
  }
}
