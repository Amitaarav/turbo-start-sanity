import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_EXPIRY_MINUTES = 15;

export function generateVerificationToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export function hashVerificationToken(token: string): string {
  return createHash("sha256")
    .update(token, "utf8")
    .digest("hex");
}

export function getVerificationExpiry(): string {
  const expiry = new Date(
    Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000
  );

  return expiry.toISOString();
}export function verifyTokenHash(
  submittedToken: string,
  storedHash: string
): boolean {
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) {
    return false;
  }

  if (!/^[a-f0-9]{64}$/i.test(submittedToken)) {
    return false;
  }

  const submittedHash = hashVerificationToken(submittedToken);

  const submittedBuffer = Buffer.from(submittedHash, "hex");
  const storedBuffer = Buffer.from(storedHash, "hex");

  return timingSafeEqual(submittedBuffer, storedBuffer);
}

export function isTokenExpired(expiresAt: string): boolean {
  return Date.now() >= new Date(expiresAt).getTime();
}
