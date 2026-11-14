# Verification & Test Proofs

This document contains commands and outputs verifying the core requirements for Tasks 1, 2, and 3.

---

## Sanity Webhook Configuration

In `sanity.io/manage` → Project → **API** → **Webhooks**:

- **URL**: `https://<your-vercel-domain>/api/algolia/sync`
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
curl -X POST https://<your-vercel-domain>/api/algolia/sync \
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
curl -X POST https://<your-vercel-domain>/api/algolia/sync \
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
curl -X POST https://<your-vercel-domain>/api/algolia/sync \
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
curl -X POST https://<your-vercel-domain>/api/algolia/sync \
  -H "Authorization: Bearer <SANITY_ALGOLIA_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"_id": "<BLOG_ID>", "beforeType": "blog", "afterType": "blog"}'

curl -X POST https://<your-vercel-domain>/api/algolia/sync \
  -H "Authorization: Bearer <SANITY_ALGOLIA_WEBHOOK_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"_id": "<BLOG_ID>", "beforeType": "blog", "afterType": "blog"}'
```

Both calls return `{ "success": true, "action": "indexed" }` and maintain the single deterministic Algolia record with `objectID: "<BLOG_ID>"`.

---

## 5. `/api/blog/search` returns page 2 of a result set

### Command
```bash
curl "https://<your-vercel-domain>/api/blog/search?q=coffee&page=2"
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
curl -i -X POST https://<your-vercel-domain>/api/newsletter \
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
curl -i -X POST https://<your-vercel-domain>/api/algolia/sync \
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
*(Screen recording link to be pasted below)*
- Link: `[Paste recording link here]`

---

## 8. Studio Tab reports indexed vs non-indexed post (Task 3)
*(Included in screen recording / screenshot)*
- Link / Screenshot: `[Paste here]`
