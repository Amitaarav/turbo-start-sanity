import "./load-env";

import { env } from "@workspace/env/server";
import { algoliasearch } from "algoliasearch";
import { ALGOLIA_BLOG_INDEX } from "../src/lib/algolia-constants";

async function verify() {
  const appId = env.ALGOLIA_APP_ID;
  const adminKey = env.ALGOLIA_ADMIN_API_KEY;

  if (!appId || !adminKey) {
    throw new Error("Missing Algolia credentials");
  }

  const algolia = algoliasearch(appId, adminKey);

  console.log("=== 1. VERIFYING INDEX SETTINGS ===");
  const settings = await algolia.getSettings({ indexName: ALGOLIA_BLOG_INDEX });
  console.log("searchableAttributes:", settings.searchableAttributes);
  console.log("attributesForFaceting:", settings.attributesForFaceting);

  console.log("\n=== 2. VERIFYING RECORD COUNT & SIZES ===");
  const searchResult = await algolia.search({
    requests: [
      {
        indexName: ALGOLIA_BLOG_INDEX,
        query: "",
        hitsPerPage: 100,
      },
    ],
  });

  const first = searchResult.results[0] as {
    hits?: Array<Record<string, unknown>>;
    nbHits?: number;
  };
  const hits = first?.hits ?? [];
  console.log(`Total records in index: ${hits.length} (nbHits: ${first?.nbHits})`);

  let maxByteSize = 0;
  for (const hit of hits) {
    const size = Buffer.byteLength(JSON.stringify(hit), "utf8");
    if (size > maxByteSize) {
      maxByteSize = size;
    }
  }
  console.log(`Max record byte size: ${maxByteSize} bytes (stega clear)`);

  console.log("\n=== 3. SAMPLE SEARCH QUERY TEST ===");
  const queryResult = await algolia.search({
    requests: [
      {
        indexName: ALGOLIA_BLOG_INDEX,
        query: "coffee",
        hitsPerPage: 5,
      },
    ],
  });
  const queryFirst = queryResult.results[0] as {
    hits?: Array<{ objectID?: string; title?: string; category?: string }>;
    nbHits?: number;
  };
  console.log(`Query 'coffee' returned ${queryFirst?.nbHits ?? 0} hits:`);
  for (const h of queryFirst?.hits ?? []) {
    console.log(`- [${h.objectID}] ${h.title} (Category: ${h.category})`);
  }
}

verify().catch((err) => {
  console.error("Verification failed:", err);
  process.exitCode = 1;
});

