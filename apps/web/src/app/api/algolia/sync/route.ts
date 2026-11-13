
import { timingSafeEqual } from "node:crypto";
import { env } from "@workspace/env/server";
import { client } from "@workspace/sanity/client";
import { Logger } from "@workspace/logger";
import { NextResponse, type NextRequest } from "next/server";
import { getAlgoliaAdminClient, ALGOLIA_BLOG_INDEX } from "@/lib/algolia";

const logger = new Logger("AlgoliaSync");

const MAX_BODY_BYTES = 4 * 1024;

interface WebhookPayload {
  _id?: unknown;
  beforeType?: unknown;
  afterType?: unknown;
}

interface SanityBlogDocument {
  _id: string;
  _createdAt: string;
  title: string;
  description?: string;
  slug?: { current?: string };
  category?: string;
  publishedAt?: string;
  featured?: boolean;
  image?: {
    asset?: {
      url?: string;
    };
    alt?: string;
  };
  authors?: Array<{
    _id: string;
    name: string;
    position?: string;
  }>;
}

function secretsMatch(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  return (
    providedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(providedBuffer, expectedBuffer)
  );
}

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7);
}

const sanityAdminClient = client.withConfig({
  token: env.SANITY_API_READ_TOKEN,
  perspective: "published",
  useCdn: false,
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
    alt
  },
  "authors": authors[]-> {
    _id,
    name,
    position
  }
}`;

export async function POST(request: NextRequest) {
  const expectedSecret = env.SANITY_ALGOLIA_WEBHOOK_SECRET;
  const providedSecret = getBearerToken(request);

  if (
    !expectedSecret ||
    !providedSecret ||
    !secretsMatch(providedSecret, expectedSecret)
  ) {
    logger.warn("Rejected unauthorized Algolia webhook request");

    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const documentId = request.headers.get("sanity-document-id");
  const operation = request.headers.get("sanity-operation");

  if (
    !documentId ||
    !["create", "update", "delete"].includes(operation ?? "")
  ) {
    return NextResponse.json(
      { error: "Invalid webhook headers" },
      { status: 400 }
    );
  }

  const bodyText = await request.text();

  if (Buffer.byteLength(bodyText, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413 }
    );
  }

  let payload: WebhookPayload;

  try {
    payload = JSON.parse(bodyText) as WebhookPayload;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  if (
    payload._id !== documentId ||
    !(
      payload.beforeType === "blog" ||
      payload.afterType === "blog"
    )
  ) {
    return NextResponse.json({
      success: true,
      action: "ignored",
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
    const document =
      await sanityAdminClient.fetch<SanityBlogDocument | null>(
        blogQuery,
        { id: documentId }
      );

    if (!document) {
      await algolia.deleteObject({
        indexName: ALGOLIA_BLOG_INDEX,
        objectID: documentId,
      });

      logger.info("Removed blog from Algolia", { documentId });

      return NextResponse.json({
        success: true,
        action: "deleted",
      });
    }

    const author = document.authors?.[0];

    const record = {
      objectID: document._id,
      title: document.title,
      description: document.description ?? "",
      slug: document.slug?.current ?? "",
      category: document.category ?? "",
      publishedAt: document.publishedAt ?? document._createdAt,
      featured: document.featured ?? false,
      authorName: author?.name ?? "",
      authorId: author?._id ?? "",
      authorPosition: author?.position ?? "",
      imageUrl: document.image?.asset?.url ?? "",
      imageAlt: document.image?.alt ?? "",
    };

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
    });
  } catch (error) {
    logger.error("Algolia synchronization failed", {
      documentId,
      errorName:
        error instanceof Error ? error.name : "UnknownError",
    });

    return NextResponse.json(
      { error: "Failed to synchronize search index" },
      { status: 500 }
    );
  }
}