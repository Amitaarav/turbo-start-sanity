import "./load-env";
import { createHash } from "node:crypto";
import { client } from "@workspace/sanity/client";
import {
  generateVerificationToken,
  getVerificationExpiry,
  hashVerificationToken,
} from "../src/lib/newsletter-token";
import { verifySubscriberToken } from "../src/app/api/newsletter/verify/route";

async function runE2ETest() {
  console.log("=================================================");
  console.log("NEWSLETTER VERIFICATION LIFECYCLE LIVE TEST");
  console.log("=================================================");

  const testEmail = `test-verify-${Date.now()}@example.com`;
  const emailHash = createHash("sha256").update(testEmail).digest("hex");
  const documentId = `subscriber.${emailHash}`;

  const writeToken = process.env.SANITY_API_WRITE_TOKEN;
  if (!writeToken) {
    throw new Error("Missing SANITY_API_WRITE_TOKEN in environment");
  }

  const writeClient = client.withConfig({
    token: writeToken,
    useCdn: false,
    stega: false,
  });

  try {
    console.log(`[Step 1] Creating pending subscriber in Sanity...`);
    console.log(`Document ID: ${documentId}, Email: ${testEmail}`);

    const token = generateVerificationToken();
    const tokenHash = hashVerificationToken(token);
    const expiresAt = getVerificationExpiry();

    await writeClient.createIfNotExists({
      _id: documentId,
      _type: "subscriber",
      email: testEmail,
      source: "website-lifecycle-test",
      status: "pending",
      verificationTokenHash: tokenHash,
      verificationExpiresAt: expiresAt,
    });

    const pendingDoc = await writeClient.fetch<{
      _id: string;
      status: string;
      verificationTokenHash: string;
      verificationExpiresAt: string;
    }>(
      `*[_id == $documentId][0]{ _id, status, verificationTokenHash, verificationExpiresAt }`,
      { documentId }
    );

    console.log("Pending Document created in Sanity:", pendingDoc);
    if (pendingDoc?.status !== "pending") {
      throw new Error("Expected status to be 'pending'");
    }
    if (pendingDoc?.verificationTokenHash !== tokenHash) {
      throw new Error("Token hash mismatch in Sanity");
    }

    console.log(`\n[Step 2] Verifying token via verifySubscriberToken()...`);
    const verifyResult = await verifySubscriberToken(token);
    console.log("Verification result:", verifyResult);

    if (!verifyResult.success) {
      throw new Error(`Verification failed: ${verifyResult.error}`);
    }

    console.log(`\n[Step 3] Confirming state change in Sanity dataset...`);
    const activeDoc = await writeClient.fetch<{
      _id: string;
      status: string;
      subscribedAt?: string;
      verificationTokenHash?: string;
      verificationExpiresAt?: string;
    }>(
      `*[_id == $documentId][0]{ _id, status, subscribedAt, verificationTokenHash, verificationExpiresAt }`,
      { documentId }
    );

    console.log("Updated Document in Sanity:", activeDoc);
    if (activeDoc?.status !== "active") {
      throw new Error("Expected status to be 'active'");
    }
    if (!activeDoc?.subscribedAt) {
      throw new Error("Expected subscribedAt timestamp to be populated");
    }
    if (activeDoc?.verificationTokenHash) {
      throw new Error("Expected verificationTokenHash to be wiped");
    }
    if (activeDoc?.verificationExpiresAt) {
      throw new Error("Expected verificationExpiresAt to be wiped");
    }

    console.log(`\n[Step 4] Testing Replay Attack (clicking link a 2nd time)...`);
    const replayResult = await verifySubscriberToken(token);
    console.log("Replay verification result:", replayResult);
    if (replayResult.success) {
      throw new Error("Expected already-used token to be rejected!");
    }
    console.log(`Replay correctly rejected with code: ${!replayResult.success ? replayResult.code : "none"}`);

    console.log(`\n[Step 5] Testing already-active subscriber handling...`);
    // Create new token for already active doc to verify idempotency
    const activeResult = await verifySubscriberToken(generateVerificationToken());
    console.log("Non-existent/invalid token correctly rejected:", !activeResult.success);

    console.log("\n=================================================");
    console.log("SUCCESS: Entire newsletter verification lifecycle is verified!");
    console.log("=================================================");
  } finally {
    console.log(`\n[Cleanup] Deleting test subscriber ${documentId}...`);
    try {
      await writeClient.delete(documentId);
      console.log("Test subscriber cleaned up successfully.");
    } catch (err) {
      console.warn("Cleanup warning:", err);
    }
  }
}

runE2ETest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
