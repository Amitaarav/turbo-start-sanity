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

---

## 2. What I noticed

- **ESM Static Import Hoisting with `dotenv`**: In `apps/web/scripts/backfill-algolia.ts`, `dotenv.config()` was called inside the script body, but static `import { env } from "@workspace/env/server"` hoisted before it, causing `@t3-oss/env-nextjs` validation to run on an unpopulated `process.env`. Decoupling environment loading into a dedicated preloaded module (`load-env.ts`) evaluated first resolves this.
- **Empty Component Stubs**: `apps/web/src/components/blog-search-results.tsx` existed in the codebase as a 0-byte empty file despite being imported by `BlogSearchLayout`. Any search trigger in the browser would fail with runtime React render errors until `BlogSearchResults` was implemented.
- **Sanity Webhook Headers vs Body**: The initial implementation of `api/algolia/sync` strictly checked `request.headers.get("sanity-document-id")`. Default Sanity webhooks transmit document metadata in the JSON request body rather than custom HTTP headers unless explicitly configured with GROQ header projections. Supporting both header and body resolution makes the webhook robust against standard Sanity configurations.

---

## 3. What I'd do with more time

- Implement an edge-compatible distributed rate limiter (e.g. Upstash Redis / Cloudflare KV) for production deployment where multiple serverless instances or regions do not share in-memory state.
- Add instant search auto-suggestions or highlighting via Algolia's snippet/highlight results.
- Implement double opt-in verification or a honeypot field for the newsletter signup to filter automated spam bots without needing CAPTCHA challenges.
