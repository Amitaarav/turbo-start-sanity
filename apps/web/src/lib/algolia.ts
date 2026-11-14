import "server-only";

import { algoliasearch } from "algoliasearch";
import { env } from "@workspace/env/server";

let adminClient: ReturnType<typeof algoliasearch> | null = null;
let searchClient: ReturnType<typeof algoliasearch> | null = null;

export function getAlgoliaAdminClient() {
  const appId = env.ALGOLIA_APP_ID;
  const adminApiKey = env.ALGOLIA_ADMIN_API_KEY;

  if (!appId || !adminApiKey) {
    return null;
  }

  if (!adminClient) {
    adminClient = algoliasearch(appId, adminApiKey);
  }

  return adminClient;
}

export function getAlgoliaSearchClient() {
  const appId =
    env.ALGOLIA_APP_ID || process.env.NEXT_PUBLIC_ALGOLIA_APP_ID;
  const searchApiKey =
    process.env.NEXT_PUBLIC_ALGOLIA_SEARCH_API_KEY ||
    process.env.ALGOLIA_SAFE_API_KEY;

  if (!appId || !searchApiKey) {
    return null;
  }

  if (!searchClient) {
    searchClient = algoliasearch(appId, searchApiKey);
  }

  return searchClient;
}

export { toAlgoliaBlogRecord } from "./algolia-record";
