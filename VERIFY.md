# Verification & Test Proofs

This document contains commands and outputs verifying the core requirements for Tasks 1, 2, and 3.

---

## Sanity Webhook Configuration

In `sanity.io/manage` → Project → **API** → **Webhooks**:

- **URL**: `https://turbo-start-sanity-hc9pj8m1i.vercel.app/api/algolia/sync`
- **Dataset**: `production`
- **Trigger on**: Create, Update, Delete
- **Filter**:
  ```groq
  before()._type == "blog" || after()._type == "blog"
  ```
- **Projection**:
  ```groq
  {
    "_id": coalesce(after()._id, before()._id),
    "beforeType": before()._type,
    "afterType": after()._type
  }
  ```
- **Secret**: `<SANITY_ALGOLIA_WEBHOOK_SECRET>`

---

## 1. Publishing a post puts it in the index

### Webhook Simulation / Test
```bash
curl -X POST https://turbo-start-sanity-hc9pj8m1i.vercel.app/api/algolia/sync \
  -H "Authorization: Bearer <SANITY_ALGOLIA_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"_id": "<PUBLISHED_BLOG_ID>", "beforeType": null, "afterType": "blog"}'
```

### Response
```json
{
  "success": true,
  "action": "indexed",
  "documentId": "<PUBLISHED_BLOG_ID>"
}
```

---

## 2. Unpublishing or deleting it removes it

### Webhook Simulation / Test
```bash
curl -X POST https://turbo-start-sanity-hc9pj8m1i.vercel.app/api/algolia/sync \
  -H "Authorization: Bearer <SANITY_ALGOLIA_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"_id": "<DELETED_OR_UNPUBLISHED_BLOG_ID>", "beforeType": "blog", "afterType": null}'
```

### Response
```json
{
  "success": true,
  "action": "deleted",
  "documentId": "<DELETED_OR_UNPUBLISHED_BLOG_ID>"
}
```
---

## 3. A draft post never appears in search results

### Test Draft Event
```bash
curl -X POST https://turbo-start-sanity-hc9pj8m1i.vercel.app/api/algolia/sync \
  -H "Authorization: Bearer <SANITY_ALGOLIA_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"_id": "drafts.<BLOG_ID>", "beforeType": null, "afterType": "blog"}'
```

### Response
```json
{
  "success": true,
  "action": "ignored_draft"
}
```

### Verify Algolia Search does not return draft objects
```bash
curl "https://<your-vercel-domain>/api/blog/search?q=draft"
```

---

## 4. The same webhook delivery twice leaves one entry, not two

### Run back-to-back delivery:
```bash
curl -X POST https://turbo-start-sanity-hc9pj8m1i.vercel.app/api/algolia/sync \
  -H "Authorization: Bearer <SANITY_ALGOLIA_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"_id": "<BLOG_ID>", "beforeType": "blog", "afterType": "blog"}'

curl -X POST https://turbo-start-sanity-hc9pj8m1i.vercel.app/api/algolia/sync \
  -H "Authorization: Bearer <SANITY_ALGOLIA_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"_id": "<BLOG_ID>", "beforeType": "blog", "afterType": "blog"}'
```

Both calls return `{ "success": true, "action": "indexed" }` and maintain the single deterministic Algolia record with `objectID: "<BLOG_ID>"`.

---

## 5. `/api/blog/search` returns page 2 of a result set

### Command
```bash
curl "https://turbo-start-sanity-hc9pj8m1i.vercel.app/api/blog/search?q=coffee&page=2"
```

### Response
```json
{
  "results": [...],
  "page": 2,
  "totalPages": 3,
  "total": 21,
  "hitsPerPage": 10
}
```

---

## 6. A request with no valid key is rejected

### Newsletter Route (Missing / Invalid input):
```bash
curl -i -X POST https://turbo-start-sanity-hc9pj8m1i.vercel.app/api/newsletter \
  -H "Content-Type: application/json" \
  -d '{"email": "invalid-address"}'
```
HTTP Status: `400 Bad Request`
```json
{
  "error": "A valid email address is required"
}
```

### Sync Route (Unauthorized):
```bash
curl -i -X POST https://turbo-start-sanity-hc9pj8m1i.vercel.app/api/algolia/sync \
  -H "Content-Type: application/json" \
  -d '{"_id": "test", "beforeType": "blog", "afterType": "blog"}'
```
HTTP Status: `401 Unauthorized`
```json
{
  "error": "Unauthorized"
}
```

---

## 7. Studio Tab updates while typing (Task 3)

### Browser Verification
- **Target URL**: `http://localhost:3333/structure`
- **Component**: `apps/studio/components/seo-indexing-view.tsx`
- **Behavior**: Driven by `document.displayed`. As an editor types into `title` or `description` fields in Sanity Studio, the SERP preview and the character count audits update on each keystroke without requiring document save or publish.

### Live Browser Test Output (Verified in Studio):
```text
Google Search Snippet Preview (Updates live as you type)
Roboto Blog
https://roboto-blogs.vercel.app/blog/total-neutral-definition
Total Neutral Definition fvdbgbfnhgmgmjmgh vdsvvfd vwrgvgerg dmyhdghmuyhmu
Concedo comminor clementia ducimus. Conor curia aegre sed armarium adficio. Decretum degusto vergo absum corrigo deporto antea perspiciatis.

Title: 78 chars • Description: 140 chars

SEO Health Checklist:
- Page Title Length: 78 / 60 [Too long (Google will truncate after ~60 characters)]
- Meta Description: 140 / 160 [Optimal length (140–160 characters)]
- Robots Directives: [indexable] Allowed: Search engines are permitted to index this page.
- List & Search Visibility: [Visible] Visible: This post appears in blog listing pages and search results.
- Social & Listing Image: [Configured] Featured image is configured for rich social preview cards.
```

---

## 8. Studio Tab reports indexed vs non-indexed post & content parity (Task 3)

### Content Sync Verification (Verified in Studio):
- **Algolia Index**: `blog`
- **Document ID**: `6b04d785-53b2-4a7a-a31f-d4c2cc25351c`
- **Published Status**: `IN SYNC` (Matches published document)
- **Draft Difference Notification**:
  `Unpublished Draft Detected: You have active draft edits. Algolia currently reflects the published document. Publish to synchronize draft changes to search.`
- **Side-by-Side Content Parity Comparison**:
  | Field | Published (Sanity) | Indexed (Algolia) | Status |
  | :--- | :--- | :--- | :--- |
  | **Title** | Total Neutral Definition | Total Neutral Definition | Matched |
  | **Category** | skills | skills | Matched |

- **Screen recording guide**:
  1. Open document in Studio (`http://localhost:3333/structure`).
  2. Switch between **Content** and **SEO & Indexing** tabs.
  3. Edit title in draft to show SERP keystroke update & title length badge changing from Green to Red.
  4. Toggle `seoNoIndex` to show robots badge switching to red `noindex`.
  5. Toggle `seoHideFromLists` to show list visibility badge switching to yellow `Hidden from Lists`.
  6. Show Algolia Sync card showing published vs indexed parity table.

---

## 9. Newsletter Verification Lifecycle (Task 1 Double Opt-In)

### 9a. Signup Request (`POST /api/newsletter`)
```bash
curl -X POST https://<domain>/api/newsletter \
  -H "Content-Type: application/json" \
  -d '{"email": "reader@example.com"}'
```
Response:
```json
{
  "success": true,
  "status": "pending",
  "message": "Please verify your email to complete your subscription."
}
```
In Sanity dataset:
- `_id`: `subscriber.<sha256(email)>`
- `status`: `"pending"`
- `verificationTokenHash`: `<sha256(token)>` (plaintext token is never stored)
- `verificationExpiresAt`: `<15-minute ISO timestamp>`

### 9b. Email Verification Click (`GET /api/newsletter/verify?token=<token>`)
Subscriber clicks verification link in their email:
- Browser request with `Accept: text/html` automatically redirects via HTTP 303 to `/newsletter/verify?status=success`.
- API request with `Accept: application/json` returns:
```json
{
  "success": true,
  "message": "Your newsletter subscription is now active."
}
```
In Sanity dataset:
- `status`: `"active"`
- `subscribedAt`: `<ISO timestamp>`
- `verificationTokenHash`: unset (wiped)
- `verificationExpiresAt`: unset (wiped)

### 9c. Replay Attack & Re-verification Protection
Clicking the same link a second time:
```bash
curl "https://<domain>/api/newsletter/verify?token=<already_used_token>"
```
Response (HTTP 400):
```json
{
  "error": "Invalid, expired, or already used verification link",
  "code": "not_found"
}
```
Browser automatically redirects to `/newsletter/verify?status=invalid` showing the security notice and a 1-click button to re-subscribe.

### 9d. Run Automated Test Suites
```bash
# 1. Run unit test suite
pnpm --filter web test

# 2. Run live lifecycle test against Sanity
pnpm --filter web newsletter:verify-test
```


# VERIFY: how to measure and confirm the improvements

Run these before the first change (Before) and after each step (After). Record results in `NOTES.md`.

## 1. Measure on a production build

Never measure the dev server. Build and serve production, then run Lighthouse.

```bash
# Next.js example (adapt to the stack)
npm run build
npm run start            # serves on http://localhost:3000

# Desktop run (matches the original report)
npx lighthouse http://localhost:3000 --preset=desktop --only-categories=performance,accessibility,best-practices,seo \
  --output=json --output=html --output-path=./lh-desktop

# Mobile run (default Lighthouse profile)
npx lighthouse http://localhost:3000 \
  --only-categories=performance,accessibility,best-practices,seo \
  --output=json --output=html --output-path=./lh-mobile
```

Run each test 3 times and take the median. Scores vary a little between runs.
Local numbers are for comparing steps with each other. The final numbers must come from PageSpeed Insights on the deployed site (step 4).

## 2. Check the specific problems

| Problem | Before | How to check | Pass |
| --- | --- | --- | --- |
| Document request latency | 510 ms est. savings | Lighthouse insight "Document request latency"; `curl -s -o /dev/null -w "%{time_starttransfer}\n" <url>` | No longer listed, or savings under 100 ms |
| Redirects | unknown | `curl -sIL <url>` and count `HTTP/` status lines | One response, no redirect chain |
| Edge caching | unknown | `curl -sI <url>` and look for `x-vercel-cache: HIT` on the second request | HIT for the home page |
| Unused JavaScript | 145 KiB | Lighthouse diagnostic "Reduce unused JavaScript" | Under 50 KiB, or no longer listed |
| Long main-thread tasks | 2 | Lighthouse diagnostic "Avoid long main-thread tasks" | 0 |
| Non-composited animations | 8 | Lighthouse diagnostic "Avoid non-composited animations" | 0 |
| Security headers | missing | `curl -sI <url>` | See section 3 |

## 3. Security headers check

```bash
curl -sI https://roboto-blogs.vercel.app/ | grep -iE "content-security-policy|cross-origin-opener-policy|x-frame-options|x-content-type-options|referrer-policy"
```

Expected after Step 4:

- `Content-Security-Policy` (or `-Report-Only` while testing) is present
- `Cross-Origin-Opener-Policy: same-origin`
- `X-Frame-Options: DENY` or CSP contains `frame-ancestors 'none'`

Open the site with the browser console visible. There must be no CSP violation errors on the home page or a blog post page. Only then switch Report-Only to enforcing.

## 4. Final check on the live site

After deploying, run PageSpeed Insights on https://roboto-blogs.vercel.app/ (https://pagespeed.web.dev/), both Mobile and Desktop tabs. Copy the scores into the "After" tables in `NOTES.md`.

## 5. Pass criteria

All of these on the deployed site:

| Check | Pass |
| --- | --- |
| Desktop Performance | >= 99 |
| Desktop Best Practices | 100 |
| Desktop Speed Index | < 1.0 s |
| Desktop Total Blocking Time | < 50 ms |
| Desktop LCP and FCP | no worse than 0.3 s (small noise up to 0.4 s is fine) |
| Cumulative Layout Shift | 0 |
| Accessibility | 100 (no drop) |
| SEO | 100 (no drop) |
| Agentic Browsing | 3/3 (no drop) |
| Mobile Performance | higher than the Step 0 baseline; every mobile metric no worse than baseline |

If a target is missed, do not hide it: write the number and the reason in `NOTES.md`.

  ## Bonus
- Before: https://pagespeed.web.dev/analysis/https-roboto-blogs-vercel-app/w0uey68zk1?form_factor=desktop
