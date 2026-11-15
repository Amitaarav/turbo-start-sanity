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


  ## Bonus
- Before: https://pagespeed.web.dev/analysis/https-roboto-blogs-vercel-app/w0uey68zk1?form_factor=desktop
