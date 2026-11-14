import "./load-env";

import { env } from "@workspace/env/server";
import { client } from "@workspace/sanity/client";

async function addNewsletterBlock() {
  const writeToken = env.SANITY_API_WRITE_TOKEN;
  if (!writeToken) {
    throw new Error("Missing SANITY_API_WRITE_TOKEN");
  }

  const writeClient = client.withConfig({
    token: writeToken,
    perspective: "published",
    useCdn: false,
    stega: false,
  });

  console.log("Checking homePage document in Sanity...");
  const homeDoc = await writeClient.fetch<{
    _id: string;
    title?: string;
    pageBuilder?: Array<{ _type?: string; _key?: string }>;
  }>(`*[_id == "homePage"][0]{ _id, title, pageBuilder }`);

  if (!homeDoc) {
    console.error("Home page document not found in Sanity dataset.");
    process.exitCode = 1;
    return;
  }

  const hasNewsletter = (homeDoc.pageBuilder ?? []).some(
    (b) => b._type === "subscribeNewsletter"
  );

  if (hasNewsletter) {
    console.log("✓ 'subscribeNewsletter' block is already present on the home page!");
    return;
  }

  console.log("Adding 'subscribeNewsletter' block to home page...");

  const newsletterBlock = {
    _key: `newsletter-${Date.now().toString(36)}`,
    _type: "subscribeNewsletter",
    title: "Subscribe to our newsletter",
    subTitle: [
      {
        _key: "st1",
        _type: "block",
        style: "normal",
        markDefs: [],
        children: [
          {
            _key: "st1c",
            _type: "span",
            text: "Get the latest engineering insights, product updates, and articles delivered directly to your inbox.",
            marks: [],
          },
        ],
      },
    ],
    helperText: [
      {
        _key: "ht1",
        _type: "block",
        style: "normal",
        markDefs: [],
        children: [
          {
            _key: "ht1c",
            _type: "span",
            text: "Zero spam. Unsubscribe at any time with one click.",
            marks: [],
          },
        ],
      },
    ],
  };

  const updated = await writeClient
    .patch("homePage")
    .setIfMissing({ pageBuilder: [] })
    .append("pageBuilder", [newsletterBlock])
    .commit();

  console.log(
    `Successfully added 'subscribeNewsletter' block to home page! Updated document: ${updated._id}`
  );
}

addNewsletterBlock().catch((err) => {
  console.error("Failed to add newsletter block:", err);
  process.exitCode = 1;
});

