import "server-only";

import { algoliasearch } from "algoliasearch";
import { env } from "@workspace/env/server";

export const ALGOLIA_BLOG_INDEX = "blog";

let adminClient: ReturnType<typeof algoliasearch> | null = null;

export function getAlgoliaAdminClient() {
  const appId = env.ALGOLIA_APP_ID;
  const adminApiKey = env.ALGOLIA_ADMIN_API_KEY;

  // Algolia is optional during initial setup.
  // Callers must handle a missing client with HTTP 503.
  if (!appId || !adminApiKey) {
    return null;
  }

  if (!adminClient) {
    adminClient = algoliasearch(appId, adminApiKey);
  }

  return adminClient;
}
