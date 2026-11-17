import { createHash } from "node:crypto";
import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";
import { client } from "@workspace/sanity/client";
import { type NextRequest, NextResponse } from "next/server";
import { RateLimiter, getClientIp } from "@/lib/rate-limit";
import { generateVerificationToken, getVerificationExpiry, hashVerificationToken } from "@/lib/newsletter-token";

type SubscriberState = {
  _id: string;
  _rev: string;
  status: "pending" | "active" |  "unsubscribed";
  verificationTokenHash?: string;
  verificationTokenExpiry?: string;
}

type SubscriptionResult =
  | { status: "pending"; token: string }
  | { status: "active" };

const logger = new Logger("NewsletterAPI");

const MAX_BODY_BYTES = 4 * 1024;

const newsletterRateLimiter = new RateLimiter({
  maxRequests: 5,
  windowMs: 15 * 60 * 1000,
});

const EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function isValidEmail(email: string): boolean {
  if (!email || typeof email !== "string") {
    return false;
  }
  const trimmed = email.trim();
  return trimmed.length <= 254 && EMAIL_REGEX.test(trimmed);
}

async function createOrUpdatePendingSubscriber(
  writeClient: ReturnType<typeof client.withConfig>,
  documentId: string,
  email: string
): Promise<SubscriptionResult> {
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = generateVerificationToken();
    const tokenHash = hashVerificationToken(token);
    const expiresAt = getVerificationExpiry();

    const existing = await writeClient.fetch<SubscriberState | null>(
      `*[_id == $documentId][0]{
        _id,
        _rev,
        status,
        verificationTokenHash
      }`,
      { documentId }
    );

    // First subscription: create a pending document.
    if (!existing) {
      await writeClient.createIfNotExists({
        _id: documentId,
        _type: "subscriber",
        email,
        source: "website",
        status: "pending",
        verificationTokenHash: tokenHash,
        verificationExpiresAt: expiresAt,
      });

      // Verify that our token actually won the create race.
      const created = await writeClient.fetch<SubscriberState | null>(
        `*[_id == $documentId][0]{
          _id,
          _rev,
          status,
          verificationTokenHash
        }`,
        { documentId }
      );

      if (created?.verificationTokenHash === tokenHash) {
        return { status: "pending", token };
      }

      // Another request created the document first.
      // Retry and handle it as an existing subscriber.
      continue;
    }

    // An already-active subscriber needs no new verification.
    if (existing.status === "active") {
      return { status: "active" };
    }

    try {
      await writeClient
        .patch(documentId)
        .ifRevisionId(existing._rev)
        .set({
          status: "pending",
          verificationTokenHash: tokenHash,
          verificationExpiresAt: expiresAt,
        })
        .unset(["subscribedAt"])
        .commit();

      return { status: "pending", token };
    } catch {
      // The document may have changed since we read its revision.
      // Re-fetch and re-evaluate instead of blindly overwriting it.
      const latest = await writeClient.fetch<SubscriberState | null>(
        `*[_id == $documentId][0]{
          _id,
          _rev,
          status,
          verificationTokenHash
        }`,
        { documentId }
      );

      if (latest?.verificationTokenHash === tokenHash) {
        return { status: "pending", token };
      }

      if (latest?.status === "active") {
        return { status: "active" };
      }

      if (attempt === maxAttempts - 1) {
        throw new Error("Could not safely update subscriber state");
      }
    }
  }

  throw new Error("Could not create or update subscriber");
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rateLimit = newsletterRateLimiter.check(ip);

  const rateLimitHeaders = {
    "X-RateLimit-Limit": String(rateLimit.limit),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(rateLimit.reset),
  };

  if (!rateLimit.success) {
    logger.warn("Newsletter signup rate limit exceeded", { ip });
    return NextResponse.json(
      { error: "Too many subscription attempts. Please try again later." },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders,
          "Retry-After": String(Math.max(1, rateLimit.reset - Math.floor(Date.now() / 1000))),
        },
      }
    );
  }

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413, headers: rateLimitHeaders }
    );
  }

  const contentType = req.headers.get("content-type") || "";
  let rawEmail: unknown;

  try {
    if (contentType.includes("application/json")) {
      const json = await req.json();
      rawEmail = json?.email;
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await req.formData();
      rawEmail = formData.get("email");
    } else {
      try {
        const json = await req.json();
        rawEmail = json?.email;
      } catch {
        const formData = await req.formData();
        rawEmail = formData.get("email");
      }
    }
  } catch {
    return NextResponse.json(
      { error: "Bad request: invalid request body format" },
      { status: 400, headers: rateLimitHeaders }
    );
  }

  if (typeof rawEmail !== "string" || !isValidEmail(rawEmail)) {
    return NextResponse.json(
      { error: "A valid email address is required" },
      { status: 400, headers: rateLimitHeaders }
    );
  }

  const email = rawEmail.trim().toLowerCase();

  if (!env.SANITY_API_WRITE_TOKEN) {
    logger.error("Missing SANITY_API_WRITE_TOKEN configuration");
    return NextResponse.json(
      { error: "Newsletter service is temporarily unavailable" },
      { status: 503, headers: rateLimitHeaders }
    );
  }

  try {
    const writeClient = client.withConfig({
      token: env.SANITY_API_WRITE_TOKEN,
      useCdn: false,
    });

    // Deterministic _id ensures that identical email submissions are idempotent
    // and never create duplicate records, even during race conditions.
    const emailHash = createHash("sha256").update(email).digest("hex");
    const documentId = `subscriber.${emailHash}`;

    const result = await createOrUpdatePendingSubscriber(
      writeClient,
      documentId,
      email
    );

    logger.info("Newsletter subscription processed", {
      documentId,
      status: result.status,
      maskedEmail: `${email.slice(0, 2)}***@${email.split("@")[1]}`,
    });

    // If submitted via browser standard form navigation, redirect back to referer
    const acceptHeader = req.headers.get("accept") || "";
    if (acceptHeader.includes("text/html")) {
      const referer = req.headers.get("referer") || "/";
      const redirectUrl = new URL(referer, req.url);
      redirectUrl.searchParams.set("subscribed", result.status === "active" ? "already-active" : "pending");
      return NextResponse.redirect(redirectUrl, {
        status: 303,
        headers: rateLimitHeaders,
      });
    }

    // Return the simulated verification URL only in development.
  const verificationUrl =
    result.status === "pending" &&
    process.env.NODE_ENV === "development"
      ? (() => {
          const url = new URL("/api/newsletter/verify", req.nextUrl.origin);
          url.searchParams.set("token", result.token);
          return url.toString();
        })()
      : undefined;

    return NextResponse.json(
        {
          success: true,
          status: result.status,
          message:
            result.status === "active"
              ? "You are already subscribed."
              : "Please verify your email to complete your subscription.",
          ...(verificationUrl ? { verificationUrl } : {}),
        },
      { status: result.status === "active" ? 200 : 202, headers: rateLimitHeaders }
    );
  } catch (error) {
    logger.error("Failed to write subscriber to Sanity", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return NextResponse.json(
      { error: "Failed to process subscription" },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}

