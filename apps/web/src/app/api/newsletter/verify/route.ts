import { env } from "@workspace/env/server";
import { Logger } from "@workspace/logger";
import { client } from "@workspace/sanity/client";
import { type NextRequest, NextResponse } from "next/server";
import { hashVerificationToken } from "@/lib/newsletter-token";

const logger = new Logger("NewsletterVerificationAPI");

type PendingSubscriber = {
  _id: string;
  _rev: string;
  email: string;
  status: "pending" | "active" | "unsubscribed";
  verificationTokenHash?: string;
  verificationExpiresAt?: string;
};

export type VerifyResult =
  | { success: true; status: 200; message: string; subscriberId: string }
  | {
      success: false;
      status: 400 | 409 | 500 | 503;
      error: string;
      code: "invalid_token" | "not_found" | "already_active" | "expired" | "conflict" | "unavailable" | "server_error";
    };

function isValidToken(token: unknown): token is string {
  return typeof token === "string" && /^[a-f0-9]{64}$/i.test(token);
}

export async function verifySubscriberToken(token: unknown): Promise<VerifyResult> {
  // 1. Validate token format (32 bytes hex = 64 characters).
  if (!isValidToken(token)) {
    return {
      success: false,
      status: 400,
      error: "Invalid or expired verification link",
      code: "invalid_token",
    };
  }

  // 2. Fail closed if Sanity write credentials are unavailable.
  if (!env.SANITY_API_WRITE_TOKEN) {
    logger.error("Missing Sanity write configuration");
    return {
      success: false,
      status: 503,
      error: "Verification service is temporarily unavailable",
      code: "unavailable",
    };
  }

  try {
    const writeClient = client.withConfig({
      token: env.SANITY_API_WRITE_TOKEN,
      useCdn: false,
      stega: false,
    });

    // 3. Hash the submitted token.
    const tokenHash = hashVerificationToken(token);

    // 4. Find the subscriber using the token hash.
    const subscriber = await writeClient.fetch<PendingSubscriber | null>(
      `*[_type == "subscriber" && verificationTokenHash == $tokenHash][0]{
        _id,
        _rev,
        email,
        status,
        verificationTokenHash,
        verificationExpiresAt
      }`,
      { tokenHash }
    );

    if (!subscriber) {
      return {
        success: false,
        status: 400,
        error: "Invalid, expired, or already used verification link",
        code: "not_found",
      };
    }

    // 5. Already active subscriber
    if (subscriber.status === "active") {
      return {
        success: true,
        status: 200,
        message: "Your newsletter subscription is already active.",
        subscriberId: subscriber._id,
      };
    }

    // 6. Only pending subscribers can be verified.
    if (subscriber.status !== "pending") {
      return {
        success: false,
        status: 409,
        error: "This subscription cannot be verified",
        code: "conflict",
      };
    }

    // 7. Validate expiry.
    const expiryTime = Date.parse(subscriber.verificationExpiresAt ?? "");
    if (!Number.isFinite(expiryTime) || Date.now() >= expiryTime) {
      return {
        success: false,
        status: 400,
        error: "Verification link has expired. Please subscribe again.",
        code: "expired",
      };
    }

    // 8. Atomically activate the subscriber and consume the token.
    try {
      await writeClient
        .patch(subscriber._id)
        .ifRevisionId(subscriber._rev)
        .set({
          status: "active",
          subscribedAt: new Date().toISOString(),
        })
        .unset([
          "verificationTokenHash",
          "verificationExpiresAt",
          "unsubscribedAt",
        ])
        .commit();
    } catch (error) {
      const isConflict =
        typeof error === "object" &&
        error !== null &&
        "statusCode" in error &&
        error.statusCode === 409;

      if (isConflict) {
        // Re-read to confirm if another concurrent request already activated it
        const latest = await writeClient.fetch<PendingSubscriber | null>(
          `*[_id == $id][0]{ _id, status }`,
          { id: subscriber._id }
        );

        if (latest?.status === "active") {
          return {
            success: true,
            status: 200,
            message: "Your newsletter subscription is now active.",
            subscriberId: subscriber._id,
          };
        }

        return {
          success: false,
          status: 409,
          error: "This verification link has already been used or is no longer valid",
          code: "conflict",
        };
      }

      throw error;
    }

    logger.info("Subscriber verified successfully", {
      subscriberId: subscriber._id,
    });

    return {
      success: true,
      status: 200,
      message: "Your newsletter subscription is now active.",
      subscriberId: subscriber._id,
    };
  } catch (error) {
    logger.error("Newsletter verification failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      success: false,
      status: 500,
      error: "Unable to verify subscription. Please try again.",
      code: "server_error",
    };
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const result = await verifySubscriberToken(token);

  const acceptsHtml = req.headers.get("accept")?.includes("text/html");

  if (acceptsHtml) {
    const redirectUrl = new URL("/newsletter/verify", req.nextUrl.origin);

    if (result.success) {
      redirectUrl.searchParams.set("status", "success");
    } else {
      switch (result.code) {
        case "expired":
          redirectUrl.searchParams.set("status", "expired");
          break;
        case "conflict":
        case "not_found":
        case "invalid_token":
          redirectUrl.searchParams.set("status", "invalid");
          break;
        case "unavailable":
        case "server_error":
        default:
          redirectUrl.searchParams.set("status", "error");
          break;
      }
    }

    return NextResponse.redirect(redirectUrl, { status: 303 });
  }

  if (result.success) {
    return NextResponse.json(
      { success: true, message: result.message },
      { status: result.status }
    );
  }

  return NextResponse.json(
    { error: result.error, code: result.code },
    { status: result.status }
  );
}

export async function POST(req: NextRequest) {
  let token: unknown;

  try {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = await req.json();
      token = body?.token;
    } else if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await req.formData();
      token = formData.get("token");
    } else {
      const body = await req.json();
      token = body?.token;
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  const result = await verifySubscriberToken(token);

  if (result.success) {
    return NextResponse.json(
      { success: true, message: result.message },
      { status: result.status }
    );
  }

  return NextResponse.json(
    { error: result.error, code: result.code },
    { status: result.status }
  );
}
