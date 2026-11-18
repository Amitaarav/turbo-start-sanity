import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const mockFetch = vi.fn();
  const mockCommit = vi.fn();
  const mockSet = vi.fn();
  const mockUnset = vi.fn();
  const mockIfRevisionId = vi.fn();
  const mockPatch = vi.fn();

  const mockClient = {
    fetch: mockFetch,
    patch: mockPatch,
    withConfig: vi.fn(),
  };
  mockClient.withConfig.mockReturnValue(mockClient);

  return {
    mockFetch,
    mockCommit,
    mockSet,
    mockUnset,
    mockIfRevisionId,
    mockPatch,
    mockClient,
  };
});

vi.mock("@workspace/env/server", () => ({
  env: {
    SANITY_API_WRITE_TOKEN: "mock-write-token",
    RESEND_API_KEY: "mock-resend-key",
    NEWSLETTER_FROM_EMAIL: "onboarding@resend.dev",
  },
}));

vi.mock("@workspace/sanity/client", () => ({
  client: mocks.mockClient,
}));

import {
  generateVerificationToken,
  getVerificationExpiry,
  hashVerificationToken,
} from "@/lib/newsletter-token";
import { verifySubscriberToken } from "./verify/route";

describe("Newsletter Verification Lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockClient.withConfig.mockReturnValue(mocks.mockClient);
    mocks.mockPatch.mockReturnValue({
      ifRevisionId: mocks.mockIfRevisionId.mockReturnValue({
        set: mocks.mockSet.mockReturnValue({
          unset: mocks.mockUnset.mockReturnValue({
            commit: mocks.mockCommit.mockResolvedValue({}),
          }),
        }),
      }),
    });
  });

  it("rejects invalid token formats immediately", async () => {
    const result = await verifySubscriberToken("invalid-short-token");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
      expect(result.code).toBe("invalid_token");
    }
  });

  it("returns not_found when token does not match any subscriber", async () => {
    mocks.mockFetch.mockResolvedValueOnce(null);

    const validHexToken = generateVerificationToken();
    const result = await verifySubscriberToken(validHexToken);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
      expect(result.code).toBe("not_found");
    }
  });

  it("handles already-active subscribers gracefully", async () => {
    const validHexToken = generateVerificationToken();
    mocks.mockFetch.mockResolvedValueOnce({
      _id: "subscriber.123",
      _rev: "rev1",
      email: "test@example.com",
      status: "active",
    });

    const result = await verifySubscriberToken(validHexToken);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.status).toBe(200);
      expect(result.message).toContain("already active");
    }
  });

  it("rejects expired verification tokens", async () => {
    const validHexToken = generateVerificationToken();
    const pastDate = new Date(Date.now() - 30 * 60 * 1000).toISOString();

    mocks.mockFetch.mockResolvedValueOnce({
      _id: "subscriber.123",
      _rev: "rev1",
      email: "test@example.com",
      status: "pending",
      verificationExpiresAt: pastDate,
      verificationTokenHash: hashVerificationToken(validHexToken),
    });

    const result = await verifySubscriberToken(validHexToken);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
      expect(result.code).toBe("expired");
    }
  });

  it("atomically activates pending subscribers and unsets verification tokens", async () => {
    const validHexToken = generateVerificationToken();
    const futureDate = getVerificationExpiry();

    mocks.mockFetch.mockResolvedValueOnce({
      _id: "subscriber.123",
      _rev: "rev1",
      email: "test@example.com",
      status: "pending",
      verificationExpiresAt: futureDate,
      verificationTokenHash: hashVerificationToken(validHexToken),
    });

    const result = await verifySubscriberToken(validHexToken);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.status).toBe(200);
      expect(result.message).toContain("now active");
    }

    expect(mocks.mockPatch).toHaveBeenCalledWith("subscriber.123");
    expect(mocks.mockIfRevisionId).toHaveBeenCalledWith("rev1");
    expect(mocks.mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "active",
      })
    );
    expect(mocks.mockUnset).toHaveBeenCalledWith([
      "verificationTokenHash",
      "verificationExpiresAt",
      "unsubscribedAt",
    ]);
    expect(mocks.mockCommit).toHaveBeenCalled();
  });

  it("resolves revision conflict safely if subscriber was concurrently activated", async () => {
    const validHexToken = generateVerificationToken();
    const futureDate = getVerificationExpiry();

    mocks.mockFetch.mockResolvedValueOnce({
      _id: "subscriber.123",
      _rev: "rev1",
      email: "test@example.com",
      status: "pending",
      verificationExpiresAt: futureDate,
      verificationTokenHash: hashVerificationToken(validHexToken),
    });

    // Simulate 409 conflict on commit
    mocks.mockCommit.mockRejectedValueOnce({ statusCode: 409 });

    // Latest fetch shows subscriber became active
    mocks.mockFetch.mockResolvedValueOnce({
      _id: "subscriber.123",
      status: "active",
    });

    const result = await verifySubscriberToken(validHexToken);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.status).toBe(200);
      expect(result.message).toContain("now active");
    }
  });
});
