import { createHash } from "node:crypto";
import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";
import { client } from "@workspace/sanity/client";
import { type NextRequest, NextResponse } from "next/server";
import { RateLimiter, getClientIp } from "@/lib/rate-limit";

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

    await writeClient.createIfNotExists({
      _id: documentId,
      _type: "subscriber",
      email,
      subscribedAt: new Date().toISOString(),
      source: "website",
      status: "active",
    });

    logger.info("Subscriber saved successfully", {
      documentId,
      maskedEmail: `${email.slice(0, 2)}***@${email.split("@")[1]}`,
    });

    // If submitted via browser standard form navigation, redirect back to referer
    const acceptHeader = req.headers.get("accept") || "";
    if (acceptHeader.includes("text/html")) {
      const referer = req.headers.get("referer") || "/";
      const redirectUrl = new URL(referer, req.url);
      redirectUrl.searchParams.set("subscribed", "true");
      return NextResponse.redirect(redirectUrl, {
        status: 303,
        headers: rateLimitHeaders,
      });
    }

    return NextResponse.json(
      { success: true, message: "Thank you for subscribing!" },
      { status: 201, headers: rateLimitHeaders }
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

