import { describe, expect, it } from "vitest";
import {
  generateVerificationToken,
  getVerificationExpiry,
  hashVerificationToken,
  isTokenExpired,
  verifyTokenHash,
} from "./newsletter-token";

describe("newsletter-token", () => {
  it("generates a 64-character cryptographically secure hex token", () => {
    const token = generateVerificationToken();
    expect(token).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/i.test(token)).toBe(true);
  });

  it("produces deterministic SHA-256 hex hashes", () => {
    const token = generateVerificationToken();
    const hash1 = hashVerificationToken(token);
    const hash2 = hashVerificationToken(token);

    expect(hash1).toHaveLength(64);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(token);
  });

  it("calculates verification expiry ~15 minutes in the future", () => {
    const before = Date.now();
    const expiry = getVerificationExpiry();
    const expiryTime = new Date(expiry).getTime();
    const after = Date.now();

    const fifteenMinutesMs = 15 * 60 * 1000;
    expect(expiryTime).toBeGreaterThanOrEqual(before + fifteenMinutesMs);
    expect(expiryTime).toBeLessThanOrEqual(after + fifteenMinutesMs + 1000);
  });

  it("correctly identifies expired timestamps", () => {
    const past = new Date(Date.now() - 60 * 1000).toISOString();
    const future = new Date(Date.now() + 60 * 1000).toISOString();

    expect(isTokenExpired(past)).toBe(true);
    expect(isTokenExpired(future)).toBe(false);
  });

  it("verifies matching token and stored hash using timingSafeEqual", () => {
    const token = generateVerificationToken();
    const hash = hashVerificationToken(token);

    expect(verifyTokenHash(token, hash)).toBe(true);

    const wrongToken = generateVerificationToken();
    expect(verifyTokenHash(wrongToken, hash)).toBe(false);
  });

  it("fails safely on invalid format or tampered hashes", () => {
    expect(verifyTokenHash("too-short", "invalid-hash")).toBe(false);
    expect(
      verifyTokenHash(
        generateVerificationToken(),
        "invalid-non-hex-hash-that-is-short"
      )
    ).toBe(false);
  });
});
