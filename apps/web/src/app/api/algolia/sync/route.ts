import { timingSafeEqual } from "node:crypto";
import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";
import { client } from "@workspace/sanity/client";
import { type NextRequest, NextResponse } from "next/server";
import { getAlgoliaAdminClient } from "@/lib/algolia";
import { ALGOLIA_BLOG_INDEX } from "@/lib/algolia-constants";
import { type SanityBlogDocument, toAlgoliaBlogRecord } from "@/lib/algolia-record";

const logger = new Logger("AlgoliaSync");

const MAX_BODY_BYTES = 4 * 1024;

interface WebhookPayload {
  _id?: string;
  _type?: string;
  beforeType?: string | null;
  afterType?: string | null;
  operation?: string;
}

function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function getProvidedSecret(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice(7);
  }

  // Also support Sanity custom secret header if configured
  const sanitySecret = request.headers.get("x-sanity-secret");
  if (sanitySecret) {
    return sanitySecret;
  }

  return null;
}

// Stega must be explicitly false so invisible encoding characters are never injected
const sanityAdminClient = client.withConfig({
  token: env.SANITY_API_READ_TOKEN,
  perspective: "published",
  useCdn: false,
  stega: false,
});

const blogQuery = `*[
  _id == $id &&
  _type == "blog" &&
  defined(slug.current) &&
  seoHideFromLists != true
][0] {
  _id,
  _createdAt,
  title,
  description,
  "slug": slug.current,
  category,
  publishedAt,
  featured,
  "image": image {
    "url": asset->url,
    "id": asset._ref,
    alt
  },
  "authors": authors[]-> {
    _id,
    name,
    position
  }
}`;

async function readLimitedBody(
  request: Request,
  maxBytes: number
): Promise<string | null> {
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(body);
}

export async function POST(request: NextRequest) {
  const expectedSecret = env.SANITY_ALGOLIA_WEBHOOK_SECRET;
  const providedSecret = getProvidedSecret(request);

  if (
    !expectedSecret ||
    !providedSecret ||
    !secretsMatch(providedSecret, expectedSecret)
  ) {
    logger.warn("Rejected unauthorized Algolia webhook request");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bodyText = await readLimitedBody(request, MAX_BODY_BYTES);
  if (bodyText === null) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let payload: WebhookPayload = {};
  if (bodyText.trim().length > 0) {
    try {
      payload = JSON.parse(bodyText) as WebhookPayload;
    } catch {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
  }

  // Resolve document ID from either custom headers or the webhook projection:
  // e.g. { "_id": coalesce(after()._id, before()._id) }
  const rawDocumentId = request.headers.get("sanity-document-id") || payload._id;
  const operation =
    request.headers.get("sanity-operation") || payload.operation || "update";

  if (!rawDocumentId) {
    return NextResponse.json(
      { error: "Missing document ID in webhook request" },
      { status: 400 }
    );
  }

  // Drafts must NEVER be indexed in search results
  if (rawDocumentId.startsWith("drafts.")) {
    logger.info("Ignoring draft document webhook event", { rawDocumentId });
    return NextResponse.json({
      success: true,
      action: "ignored_draft",
    });
  }

  const documentId = rawDocumentId;

  // Filter content types based on beforeType / afterType:
  // Match filter: before()._type == "blog" || after()._type == "blog"
  const isBlog =
    payload.afterType === "blog" ||
    payload.beforeType === "blog" ||
    payload._type === "blog";

  if (!isBlog) {
    logger.info("Ignoring non-blog document type", {
      beforeType: payload.beforeType,
      afterType: payload.afterType,
      type: payload._type,
      documentId,
    });
    return NextResponse.json({
      success: true,
      action: "ignored_non_blog",
    });
  }

  const algolia = getAlgoliaAdminClient();
  if (!algolia) {
    logger.warn("Algolia credentials are not configured");
    return NextResponse.json(
      { error: "Search service unavailable" },
      { status: 503 }
    );
  }

  try {
    // If afterType is null/empty or operation is delete, document was deleted in Sanity
    const isExplicitlyDeleted =
      payload.afterType === null ||
      (payload.beforeType === "blog" && !payload.afterType) ||
      operation === "delete";

    let document: SanityBlogDocument | null = null;

    if (!isExplicitlyDeleted) {
      document = await sanityAdminClient.fetch<SanityBlogDocument | null>(
        blogQuery,
        { id: documentId }
      );
    }

    if (!document) {
      // Document is unpublished, hidden, or deleted -> remove from Algolia
      await algolia.deleteObject({
        indexName: ALGOLIA_BLOG_INDEX,
        objectID: documentId,
      });

      logger.info("Removed blog from Algolia", {
        documentId,
        isExplicitlyDeleted,
      });

      return NextResponse.json({
        success: true,
        action: "deleted",
        documentId,
      });
    }

    const record = toAlgoliaBlogRecord(document);
    

    // saveObject is idempotent: multiple deliveries of the same event update the same objectID
    await algolia.saveObject({
      indexName: ALGOLIA_BLOG_INDEX,
      body: record,
    });

    logger.info("Synchronized blog to Algolia", {
      documentId,
      operation,
    });

    return NextResponse.json({
      success: true,
      action: "indexed",
      documentId,
    });
  } catch (error) {
    logger.error("Algolia synchronization failed", {
      documentId,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });

    return NextResponse.json(
      { error: "Failed to synchronize search index" },
      { status: 500 }
    );
  }
}
