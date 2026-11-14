import "./load-env";

import { env } from "@workspace/env/server";
import { client } from "@workspace/sanity/client";
import { algoliasearch } from "algoliasearch";
import { ALGOLIA_BLOG_INDEX } from "../src/lib/algolia-constants";
import {
  toAlgoliaBlogRecord,
  type SanityBlogDocument,
} from "../src/lib/algolia-record";
import {
  BLOG_INDEX_SETTINGS,
} from "../src/lib/algolia-settings";

const BATCH_SIZE = 100;

const sanityClient = client.withConfig({
  token: env.SANITY_API_READ_TOKEN,
  perspective: "published",
  useCdn: false,
  stega: false,
});

const algoliaAppId = env.ALGOLIA_APP_ID;
const algoliaAdminKey = env.ALGOLIA_ADMIN_API_KEY;

if (!algoliaAppId || !algoliaAdminKey) {
  throw new Error("Algolia credentials are not configured");
}

const algolia = algoliasearch(algoliaAppId, algoliaAdminKey);

const blogQuery = `*[
  _type == "blog" &&
  defined(slug.current) &&
  seoHideFromLists != true
] | order(_id asc) {
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

async function main() {
  console.log("Fetching published blogs from Sanity...");

  const documents =
    await sanityClient.fetch<SanityBlogDocument[]>(blogQuery);

  console.log(`Found ${documents.length} eligible blogs.`);

  const records = documents.map(toAlgoliaBlogRecord);

  for (const record of records) {
    const size = Buffer.byteLength(
        JSON.stringify(record),
        "utf8"
    );

    if (size > 8_000) {
        console.log({
        objectID: record.objectID,
        title: record.title,
        size,
        imageUrlLength: record.imageUrl.length,
        descriptionLength: record.description.length,
        });
    }
    }
  console.log("Applying Algolia index settings...");
  try {
    await algolia.setSettings({
      indexName: ALGOLIA_BLOG_INDEX,
      indexSettings: BLOG_INDEX_SETTINGS,
    });
    console.log("Index settings applied.");
  } catch (warning) {
    console.warn(
      "Notice: Index settings update failed or queued:",
      warning instanceof Error ? warning.message : warning
    );
  }

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    await algolia.saveObjects({
      indexName: ALGOLIA_BLOG_INDEX,
      objects: batch,
    });

    console.log(
      `Indexed ${Math.min(i + batch.length, records.length)} / ${records.length} blogs`
    );
  }

  console.log("Backfill completed successfully.");
}

main().catch((error) => {
  console.error("Algolia backfill failed:", error);

  if (error && typeof error === "object" && "stackTrace" in error) {
    const stackTrace = (error as {
      stackTrace?: Array<{
        host?: { url?: string };
        response?: {
          status?: number;
          content?: string;
        };
      }>;
    }).stackTrace;

    console.error(
      "Algolia host diagnostics:",
      JSON.stringify(
        stackTrace?.map((item) => ({
          host: item.host?.url,
          status: item.response?.status,
          response: item.response?.content,
        })),
        null,
        2
      )
    );
  }

  process.exitCode = 1;
});