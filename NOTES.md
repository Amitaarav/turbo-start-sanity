# Notes & Decisions

## 1. What I built and why

### Task 1: Newsletter Signup

- **Studio Schema (`subscriber`)**: Defined a new `subscriber` document type in `apps/studio/schemaTypes/documents/subscriber.ts` and registered it in both the document registry and the Studio desk navigation structure with a `Mail` icon. Fields include `email` (read-only in Studio to avoid tampering), `subscribedAt` (ISO timestamp), `source` (e.g., website), and an editable `status` (`active` vs `unsubscribed`).
- **Deterministic Idempotency**: Rather than querying the dataset before inserting (which introduces race conditions under concurrent requests), the API computes a deterministic document ID: `subscriber.${sha256(email)}` and writes with Sanity's atomic `createIfNotExists`. Submitting the exact same email multiple times or double-clicking produces the same document ID, guaranteeing zero duplicate documents with no extra queries or race windows.
- **Dual Content-Type Support**: Form submissions from native browser `<form>` elements send `application/x-www-form-urlencoded` or `multipart/form-data`, whereas programmatic clients (and modern AJAX hooks) send `application/json`. `POST /api/newsletter` detects the `Content-Type` header and seamlessly parses both `req.json()` and `req.formData()`. Browser navigation posts redirect back with `303 See Other` and `?subscribed=true`, while API requests receive a 201 JSON payload.
- **Fail-Closed Security & Payload Guard**: Following the pattern established in `revalidate-sync-tags`, the route enforces a `MAX_BODY_BYTES` limit (4 KB), validates email syntax using strict RFC 5322 compliance with a 254-character boundary, and fails closed with 503 if the required write token is unconfigured.
- **Rate Limiting**: Public write endpoints require abuse mitigation. The rate limiter lives in `apps/web/src/lib/rate-limit.ts` using an in-memory sliding-window algorithm keyed on client IP (resolved via `X-Forwarded-For` / `X-Real-IP`). The threshold for newsletter signups is set to **5 requests per 15-minute window per IP**. Exceeded requests receive `HTTP 429 Too Many Requests` along with standard `Retry-After` and `X-RateLimit-*` headers.
- **Frontend Block Wiring**: Updated `SubscribeNewsletter` in `packages/sanity-blocks/src/subscribe-newsletter/index.tsx` with progressive enhancement. It defaults `action` to `/api/newsletter` and `method` to `post`. In JavaScript-enabled environments, it intercepts submit, submits via JSON `fetch`, provides loading state on the button, and renders inline accessible status messages (`role="status"`) for success or error without page reloads.

### Task 2: Algolia Search & Synchronization

#### 2a. Sync Webhook (`POST /api/algolia/sync`)
- **Fail-Closed Constant-Time Auth**: Rejects any request where the shared secret is missing or does not match `SANITY_ALGOLIA_WEBHOOK_SECRET` using `timingSafeEqual`.
- **Draft Isolation**: Sanity drafts carry an ID prefixed with `drafts.`. The webhook immediately returns `{ action: "ignored_draft" }` for draft events. Furthermore, queries against Sanity use `perspective: "published"`, guaranteeing unpublished drafts never leak into Algolia.
- **Unpublish & Delete Handling**: When a document is unpublished or deleted, querying Sanity with `perspective: "published"` returns null. The webhook catches this and calls `algolia.deleteObject(documentId)`, immediately removing stale records from the index.
- **Event Delivery Deduplication**: Algolia's `saveObject` is keyed explicitly by `objectID: document._id`. Repeated deliveries of the same Sanity event overwrite the same record idempotently rather than creating duplicates.
- **Resilient Content Filtering**: Safely ignores document types other than `blog` with `{ action: "ignored_non_blog" }` without throwing errors or crashing the route. Resolves `documentId` from either custom headers or body payloads (`payload._id`).

#### 2b. Backfill Script (`apps/web/scripts/backfill-algolia.ts`)
- **Index Settings as Code**: Applies `searchableAttributes` (`title`, `description`, `authorName`, `category`) and `attributesForFaceting` (`category`) via `algolia.setSettings` before uploading content. This prevents Algolia from searching internal IDs or URL slugs.
- **Safe to Rerun**: Batches published blogs (100 per batch) with `saveObjects`, making the script entirely idempotent and safe to run multiple times without bloating or duplicating records.

#### 2c. Search Endpoint (`GET /api/blog/search`) & UI
- **Algolia Powered**: Replaced the Fuse.js in-memory implementation with queries against Algolia search API using search-only credentials (`getAlgoliaSearchClient`). The Algolia Admin API key is never used here and never exposed to the client.
- **Rate Limiting & Abuse Prevention**: Search calls cost money and can be abused by automated bots. The route enforces an in-memory sliding-window rate limit of **60 search requests per minute per IP** via `apps/web/src/lib/rate-limit.ts`. Returns `HTTP 429 Too Many Requests` with `Retry-After` when breached.
- **Bounded Inputs**: Enforces strict bounds: query `q` is trimmed and capped to 100 characters; `page` is bounded between 1 and 100; `category` filter is capped to 50 characters.
- **Pagination & Filtering**: Returns structured pagination metadata (`page`, `totalPages`, `total`, `hitsPerPage`, `results`). Fully supports category filtering via Algolia `facetFilters`.
- **Graceful Failure on Algolia Outage**: If Algolia is down or unreachable, the route catches the failure, logs structured diagnostics, and responds with `HTTP 503 Service Unavailable` with `{ error: "Search service is temporarily unavailable", results: [], total: 0 }`. This informs callers transparently while ensuring the frontend UI renders a friendly retry state rather than crashing.
- **Frontend Search UI**: Implemented `BlogSearchResults` with responsive grid layout, loading indicators, empty states, and pagination controls. Updated `useBlogSearch` hook and wired active category filtering directly from the blog layout.

### Task 3: Sanity Studio SEO & Indexing Custom View Tab

- **Custom Document View**: Built `SeoAndIndexingView` in `apps/studio/components/seo-indexing-view.tsx` and registered it as a secondary view tab alongside the standard `Content` form in `apps/studio/structure.ts`.
- **Keystroke-Reactive SERP Preview**: Live Google Search Snippet preview driven by `document.displayed`. Reacts instantly to keystrokes in title, description, or slug without requiring the author to publish or save drafts.
- **SEO Fallback Utility Reuse**: Reused existing utilities in `apps/studio/utils/seo-fields.ts` (`resolveSeoTitle`, `resolveSeoDescription`, `resolveSeoImage`) ensuring exact parity with frontend metadata generation (e.g. falling back to post title or body text snippet when dedicated SEO fields are omitted).
- **Comprehensive SEO Health Audit**:
  - *Title Length*: Optimal at 40–60 characters; displays warning when `< 40` and critical truncation alert when `> 60`.
  - *Description Length*: Optimal at 140–160 characters; alerts when `< 140` or `> 160`.
  - *Indexability*: Inspects `seoNoIndex` flag; displays green indexable badge or warning `noindex` badge.
  - *List & Search Visibility*: Checks `seoHideFromLists`; warns if post is excluded from listings/feeds.
  - *Social & Listing Image*: Verifies presence of a configured thumbnail/social card image asset.
- **Live Algolia Content Parity Check**:
  - Replaced basic record-existence check with deep content parity evaluation against `document.published`.
  - Compares published `title`, `description`, and `category` against the live Algolia record.
  - Detects unpublished draft modifications: alerts authors when draft edits have not yet been synced to Algolia, showing a side-by-side comparison table of Sanity Published vs Algolia Record.
- **Publish-Aware Auto-Refresh**: Watches `published._rev` and automatically triggers an Algolia index recheck immediately upon publishing plus an asynchronous 2-second delayed check to allow background webhook propagation to settle.
- **Secure Configuration**: No hardcoded Algolia credentials or fallbacks. Uses Vite-bundled environment variables `SANITY_STUDIO_ALGOLIA_APP_ID` and `SANITY_STUDIO_ALGOLIA_SEARCH_KEY`.

---

## 2. What I noticed

- **ESM Static Import Hoisting with `dotenv`**: In `apps/web/scripts/backfill-algolia.ts`, `dotenv.config()` was called inside the script body, but static `import { env } from "@workspace/env/server"` hoisted before it, causing `@t3-oss/env-nextjs` validation to run on an unpopulated `process.env`. Decoupling environment loading into a dedicated preloaded module (`load-env.ts`) evaluated first resolves this.
- **Empty Component Stubs**: `apps/web/src/components/blog-search-results.tsx` existed in the codebase as a 0-byte empty file despite being imported by `BlogSearchLayout`. Any search trigger in the browser would fail with runtime React render errors until `BlogSearchResults` was implemented.
- **Sanity Webhook Headers vs Body**: The initial implementation of `api/algolia/sync` strictly checked `request.headers.get("sanity-document-id")`. Default Sanity webhooks transmit document metadata in the JSON request body rather than custom HTTP headers unless explicitly configured with GROQ header projections. Supporting both header and body resolution makes the webhook robust against standard Sanity configurations.

---

# NOTES: PageSpeed work log

Site: https://roboto-blogs.vercel.app/
Tool: PageSpeed Insights, Lighthouse 13.6.0. Baseline taken Nov 15, 2026, 9:55 AM (GMT+5:30). Follow-up runs the same day.

## Summary

- Change made: removed `QueryClientProvider` / `@tanstack/react-query` from the global `RootLayout`, replaced it with a native search hook (module-level `Map` cache with 30 s TTL, `AbortController`, `useCallback`), and removed the unused `fuse.js`.
- Desktop improved clearly: Performance 98 -> 100, Total Blocking Time 80 -> 30 ms, Speed Index 1.4 -> 0.9 s.
- Mobile improved on Speed Index (3.4 -> 2.6 s) and probably LCP (1.5 -> 1.2 s). Total Blocking Time went the wrong way (80 -> 230 ms) and needs a re-check.
- Not yet fixed: mobile contrast (Accessibility 96), console errors (Best Practices 96), security headers, animations, and the largest chunk (Sanity visual editing, about 473 KiB).
- Not measured after the change: Accessibility, Best Practices, SEO, unused JavaScript, long tasks, animations, document latency. See "Still to capture".

## Before scenario

### Desktop (baseline, 9:55 AM run)

| Metric | Before | Status |
| --- | --- | --- |
| Performance | 98 | green |
| Accessibility | 100 | green |
| Best Practices | 96 | green |
| SEO | 100 | green |
| Agentic Browsing | 3/3 | green |
| First Contentful Paint | 0.3 s | green |
| Largest Contentful Paint | 0.3 s | green |
| Total Blocking Time | 80 ms | green |
| Cumulative Layout Shift | 0 | green |
| Speed Index | 1.4 s | orange |

What the report flagged:

- Document request latency: est. 510 ms savings
- Reduce unused JavaScript: est. 145 KiB
- Avoid long main-thread tasks: 2 long tasks
- Avoid non-composited animations: 8 elements
- Best Practices: CSP, COOP, XFO or CSP clickjacking, Trusted Types not set

Real-user (field) data: "No Data" (not enough traffic yet; not a problem).

### Mobile (baseline, 9:55 AM run, Moto G Power, slow 4G)

| Metric | Before | Status |
| --- | --- | --- |
| Performance | 99 | green |
| Accessibility | 96 | green |
| Best Practices | 96 | green |
| SEO | 100 | green |
| Agentic Browsing | 3/3 | green |
| First Contentful Paint | 1.1 s | green |
| Largest Contentful Paint | 1.5 s | green |
| Total Blocking Time | 80 ms | green |
| Cumulative Layout Shift | 0 | green |
| Speed Index | 3.4 s | orange |

What the mobile report flagged (same as desktop, plus two mobile-only items):

- Document request latency: est. 530 ms savings
- Reduce unused JavaScript: est. 145 KiB
- Avoid long main-thread tasks: 2 long tasks
- Avoid non-composited animations: 8 elements
- Accessibility: "Background and foreground colors do not have a sufficient contrast ratio" (mobile only)
- Best Practices: "Browser errors were logged to the console" (mobile only), plus the same CSP, COOP, clickjacking and Trusted Types items

### Codebase facts

- Framework and version: Next.js 16.4.5 (App Router, Turbopack, React 19.2.1, Turborepo monorepo)
- Rendering mode of the home page: Next.js 16 Cache Components (`"use cache"` with Sanity sync tags, edge cached on Vercel)
- Redirects found: 1 (`http://roboto-blogs.vercel.app` -> `https://roboto-blogs.vercel.app/`, 308, standard single hop). No internal redirect chains. Nothing to fix.
- Vercel function region: `bom1` (Mumbai, India, verified from `x-vercel-id: bom1::...`)
- Top 10 largest dependencies (name, size):
  1. `@sanity/visual-editing` + `@sanity/ui` + `styled-components` (about 473 KiB client chunk `39d6eylqq2zve.js`)
  2. `@tanstack/react-query` (was pulled globally in `RootLayout` via `Providers`; now removed)
  3. `next-sanity` / `@sanity/client`
  4. `@workspace/sanity-blocks` (11 blocks bundled into client `PageBuilder`)
  5. `lucide-react`
  6. `fuse.js` (unused, replaced by Algolia; now removed)
  7. `algoliasearch`
  8. `next-themes`
  9. `@vercel/analytics`
  10. `schema-dts`

## After scenario

Latest measured values are in the "After" columns. A dash means that value was not captured for this run.

### Desktop

| Metric | Before | After | Change |
| --- | --- | --- | --- |
| Performance | 98 | 100 | +2 |
| Accessibility | 100 | 100 | - |
| Best Practices | 96 | 96 | - |
| SEO | 100 | 100 | - |
| Agentic Browsing | 3/3 | 3/3 | - |
| First Contentful Paint | 0.3 s | 0.3 s | no change |
| Largest Contentful Paint | 0.3 s | 0.3 s | no change |
| Total Blocking Time | 80 ms | 30 ms | -50 ms (better) |
| Cumulative Layout Shift | 0 | 0 | no change |
| Speed Index | 1.4 s | 0.9 s | -0.5 s (better) |
| Document request latency savings | 510 ms | - | - |
| Unused JavaScript | 145 KiB | - | - |
| Long main-thread tasks | 2 | - | - |
| Non-composited animations | 8 | - | - |

### Mobile

| Metric | Before | After | Change |
| --- | --- | --- | --- |
| Performance | 99 | 96 | no change |
| Accessibility | 96 | 96 | no change |
| Best Practices | 96 | 96 | no change |
| SEO | 100 | 100 | no change |
| Agentic Browsing | 3/3 | 3/3 | no change |
| First Contentful Paint | 1.1 s | 1.2 s | +0.1 s (within noise) |
| Largest Contentful Paint | 1.5 s | 1.2 s | -0.3 s (better, see variance) |
| Total Blocking Time | 80 ms | 230 ms | +150 ms (worse, re-check) |
| Cumulative Layout Shift | 0 | 0 | no change |
| Speed Index | 3.4 s | 2.6 s | -0.8 s (better) |
| Document request latency savings | 530 ms | - | - |
| Unused JavaScript | 145 KiB | - | - |
| Long main-thread tasks | 2 | - | - |
| Non-composited animations | 8 | - | - |

### Run-to-run variance (same URL, no code change between these)

PageSpeed results change on every run, so a single number proves little. Two runs from the same day before the code change was measured:

| Metric | Desktop 9:55 | Desktop 12:22 | Mobile 9:55 | Mobile 12:22 |
| --- | --- | --- | --- | --- |
| Performance | 98 | 98 | 99 | 99 |
| First Contentful Paint | 0.3 s | 0.4 s | 1.1 s | 1.1 s |
| Largest Contentful Paint | 0.3 s | 0.4 s | 1.5 s | 1.1 s |
| Total Blocking Time | 80 ms | 100 ms | 80 ms | 20 ms |
| Speed Index | 1.4 s | 1.3 s | 3.4 s | 3.4 s |
| Document request latency | 510 ms | 520 ms | 530 ms | 710 ms |
| Unused JavaScript | 145 KiB | 145 KiB | 145 KiB | 145 KiB |

How to read the results with this spread in mind:

- **Desktop Speed Index (1.4 / 1.3 -> 0.9 s) and Total Blocking Time (80 / 100 -> 30 ms):** outside the spread, so likely a real improvement.
- **Mobile Speed Index (3.4 / 3.4 -> 2.6 s):** outside the spread, so likely a real improvement.
- **Mobile LCP (1.5 / 1.1 -> 1.2 s):** inside the spread, so not conclusive.
- **Mobile Total Blocking Time (80 / 20 -> 230 ms):** above the spread, so it may be a real regression or one noisy run. Re-run 3 to 5 times before concluding.
- **Document request latency:** moves by 200 ms with no code change, so treat it as noise.
- The mobile "After" values were supplied without a Performance score, and without the device label on the run. They are treated as mobile because the desktop values were already recorded separately.

## What the user will notice (plain language)

Before: the page already painted fast on desktop (0.3 s), but a global data-fetching library (React Query) loaded on every page even though only the blog search used it, and the page took longer to look fully drawn.
After: the home page no longer loads that library. On desktop it is drawn sooner (Speed Index 0.9 s) and scripts block it less (30 ms). On a phone on slow 4G it looks fully drawn about 0.8 s sooner. Blog search behaves the same as before.

## Change log

### Step 1: Remove fuse.js and replace react-query with native React search hook
- Changed: `apps/web/package.json`, `apps/web/src/components/providers.tsx`, `apps/web/src/hooks/use-blog-search.ts`, `pnpm-lock.yaml`
- Measured: Desktop Performance 98 -> 100, Total Blocking Time 80 -> 30 ms, Speed Index 1.4 -> 0.9 s. Mobile Speed Index 3.4 -> 2.6 s, Total Blocking Time 80 -> 230 ms (re-check).
- Estimated saving: about 35 KiB client JavaScript (an estimate; confirm with the "First Load JS" figure for `/` in the `next build` output before and after).
- Risks or follow-ups: Search cache kept as a module-level `Map` with a 30 s TTL and an `AbortController`, so behaviour matches the old version. Unit tests pass. Unused JavaScript is still to be re-checked: the 145 KiB total is far bigger than React Query, so expect most of it to remain.

## Decisions and open questions

### Architectural decision: replace React Query with an in-memory cache and native hooks

1. **Removal of `QueryClientProvider` from `RootLayout` (`apps/web/src/components/providers.tsx`)**
   - It was mounted globally, so the whole `@tanstack/react-query` runtime shipped in the initial client bundle of every page (home, terms, landing pages).
   - Only one hook, `useBlogSearch` on the `/blog` route, used client-side queries. Removing the provider takes React Query out of the home page's critical path.

2. **In-memory `Map` cache and native hooks (`useCallback`, `AbortController`)**
   - The requirement is simple: fetch `/api/blog/search`, debounce input by 300 ms, cancel outdated requests, and cache recent queries so switching categories or pages does not refetch.
   - A module-scoped `Map<string, { data: BlogSearchResponse; timestamp: number }>` gives the same 30 s TTL with no library weight.
   - `AbortController` cancels in-flight requests on rapid typing, which prevents out-of-order responses.
   - Stable `useCallback` handlers avoid needless re-renders of `BlogSearchLayout` and the category tabs.
   - The hook keeps the same public API, so `BlogSearchResults` and `BlogPageContent` are unchanged.

- Audience region assumed to be India (Mumbai `bom1`). Confirmed via `x-vercel-id: bom1::...`.

## 3. What I'd do with more time

- Implement an edge-compatible distributed rate limiter (e.g. Upstash Redis / Cloudflare KV) for production deployment where multiple serverless instances or regions do not share in-memory state.
- Add instant search auto-suggestions or highlighting via Algolia's snippet/highlight results.
- Implement double opt-in verification or a honeypot field for the newsletter signup to filter automated spam bots without needing CAPTCHA challenges.
