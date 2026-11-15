import { Badge, Box, Button, Card, Flex, Heading, Spinner, Stack, Text } from "@sanity/ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, RefreshCw, Globe, Search, ArrowRight } from "lucide-react";
import {
  resolveSeoDescription,
  resolveSeoImage,
  resolveSeoTitle,
} from "@/utils/seo-fields";

interface AlgoliaBlogRecord {
  objectID: string;
  title?: string;
  description?: string;
  category?: string;
  authorName?: string;
  publishedAt?: string;
}

interface SeoIndexingViewProps {
  document: {
    displayed: Record<string, unknown>;
    published: Record<string, unknown> | null;
    draft: Record<string, unknown> | null;
  };
  documentId: string;
}

// Strictly from Studio environment variables, no hardcoded credentials
const ALGOLIA_APP_ID = process.env.SANITY_STUDIO_ALGOLIA_APP_ID;
const ALGOLIA_SEARCH_KEY = process.env.SANITY_STUDIO_ALGOLIA_SEARCH_KEY;
const SITE_URL =
  process.env.SANITY_STUDIO_PRESENTATION_URL || "https://roboto-blogs.vercel.app";

export function SeoAndIndexingView({ document: docState, documentId }: SeoIndexingViewProps) {
  const displayed = docState?.displayed || {};
  const published = docState?.published;
  const isPublished = Boolean(published);
  const hasUnpublishedEdits = Boolean(docState?.draft);

  // SEO Fallback logic using the utilities from @/utils/seo-fields
  const effectiveTitle = resolveSeoTitle(displayed) || "Untitled Blog Post";
  const effectiveDescription =
    resolveSeoDescription(displayed) ||
    "Add a description to preview how this blog post will appear in Google search results.";
  const seoImage = resolveSeoImage(displayed);
  const hasImage = Boolean(seoImage);

  const slug = ((displayed.slug as { current?: string })?.current) || "";
  const seoNoIndex = Boolean(displayed.seoNoIndex);
  const seoHideFromLists = Boolean(displayed.seoHideFromLists);

  const cleanId = (documentId || (displayed._id as string) || "").replace(/^drafts\./, "");
  const cleanSlug = (slug || "post-url-slug").replace(/^\/?(blog\/)?/, "");
  const canonicalUrl = `${SITE_URL.replace(/\/$/, "")}/blog/${cleanSlug}`;

  // Published document expected values for sync comparison
  const publishedTitle = resolveSeoTitle(published);
  const publishedDescription = resolveSeoDescription(published);
  const publishedCategory = (published?.category as string) || "";
  const publishedHideFromLists = Boolean(published?.seoHideFromLists);

  // Algolia state
  const [algoliaStatus, setAlgoliaStatus] = useState<"loading" | "indexed" | "not_indexed" | "error" | "missing_config">("loading");
  const [algoliaRecord, setAlgoliaRecord] = useState<AlgoliaBlogRecord | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const checkAlgoliaIndex = useCallback(async () => {
    if (!ALGOLIA_APP_ID || !ALGOLIA_SEARCH_KEY) {
      setAlgoliaStatus("missing_config");
      return;
    }

    if (!cleanId) {
      setAlgoliaStatus("not_indexed");
      return;
    }

    setIsRefreshing(true);
    try {
      const endpoint = `https://${ALGOLIA_APP_ID}-dsn.algolia.net/1/indexes/blog/${encodeURIComponent(cleanId)}`;
      const response = await fetch(endpoint, {
        headers: {
          "x-algolia-application-id": ALGOLIA_APP_ID,
          "x-algolia-api-key": ALGOLIA_SEARCH_KEY,
        },
      });

      if (response.status === 200) {
        const record = (await response.json()) as AlgoliaBlogRecord;
        setAlgoliaRecord(record);
        setAlgoliaStatus("indexed");
      } else if (response.status === 404) {
        setAlgoliaRecord(null);
        setAlgoliaStatus("not_indexed");
      } else {
        setAlgoliaStatus("error");
      }
    } catch {
      setAlgoliaStatus("error");
    } finally {
      setIsRefreshing(false);
    }
  }, [cleanId]);

  // Refresh behavior: Recheck immediately when published revision changes, and after 2s for webhook processing
  const publishedRev = (published as { _rev?: string })?._rev;
  useEffect(() => {
    checkAlgoliaIndex();

    if (publishedRev) {
      const timer = setTimeout(() => {
        checkAlgoliaIndex();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [checkAlgoliaIndex, publishedRev]);

  // Index Content Comparison: Does Algolia match the latest published document?
  const contentSyncEvaluation = useMemo(() => {
    if (!algoliaRecord) {
      return null;
    }

    if (!isPublished) {
      return {
        isInSync: false,
        status: "stale_draft",
        message: "Algolia has a record, but this document is currently unpublished in Sanity.",
      };
    }

    if (publishedHideFromLists) {
      return {
        isInSync: false,
        status: "should_be_hidden",
        message: "Document is set to 'Hide From Lists', but is still present in the Algolia search index.",
      };
    }

    const titleMatches = algoliaRecord.title === publishedTitle;
    const descMatches = !publishedDescription || algoliaRecord.description === publishedDescription;
    const categoryMatches = !publishedCategory || algoliaRecord.category === publishedCategory;

    const isInSync = titleMatches && descMatches && categoryMatches;

    return {
      isInSync,
      titleMatches,
      descMatches,
      categoryMatches,
      status: isInSync ? "in_sync" : "content_mismatch",
      message: isInSync
        ? "Algolia index perfectly matches the latest published Sanity document."
        : "Algolia search index is out of sync with your latest published document.",
    };
  }, [algoliaRecord, isPublished, publishedHideFromLists, publishedTitle, publishedDescription, publishedCategory]);

  // Title length audit
  const titleLength = effectiveTitle.length;
  const titleStatus = useMemo(() => {
    if (titleLength >= 40 && titleLength <= 60) {
      return { tone: "positive" as const, message: "Optimal length (40–60 characters)" };
    }
    if (titleLength < 40) {
      return { tone: "caution" as const, message: "Too short (aim for 40–60 characters)" };
    }
    return { tone: "critical" as const, message: "Too long (Google will truncate after ~60 characters)" };
  }, [titleLength]);

  // Description length audit (140-160 chars)
  const descLength = effectiveDescription.length;
  const descStatus = useMemo(() => {
    if (descLength >= 140 && descLength <= 160) {
      return { tone: "positive" as const, message: "Optimal length (140–160 characters)" };
    }
    if (descLength < 140) {
      return { tone: "caution" as const, message: "Too short (recommend at least 140 characters)" };
    }
    return { tone: "critical" as const, message: "Too long (truncated in search results after 160 characters)" };
  }, [descLength]);

  return (
    <Box padding={[3, 4, 5]}>
      <Stack gap={5} style={{ maxWidth: 860, margin: "0 auto" }}>
        {/* Header */}
        <Flex justify="space-between" align="center">
          <Stack gap={2}>
            <Heading size={3}>SEO & Indexing Monitor</Heading>
            <Text size={1} muted>
              Live SERP preview, SEO compliance checks, and real-time Algolia content sync verification.
            </Text>
          </Stack>
          <Button
            fontSize={1}
            icon={RefreshCw}
            text={isRefreshing ? "Checking..." : "Refresh Status"}
            mode="ghost"
            onClick={checkAlgoliaIndex}
            disabled={isRefreshing}
          />
        </Flex>

        {/* 1. Google SERP Preview Card */}
        <Card padding={4} radius={3} shadow={1} border>
          <Stack gap={3}>
            <Flex justify="space-between" align="center">
              <Flex align="center" style={{ gap: 8 }}>
                <Search size={16} />
                <Text size={2} weight="bold">
                  Google Search Snippet Preview
                </Text>
              </Flex>
              <Badge tone="primary" fontSize={1}>
                Updates live as you type
              </Badge>
            </Flex>

            {/* Desktop Google SERP Snippet Preview */}
            <Card
              padding={4}
              radius={2}
              style={{
                backgroundColor: "#ffffff",
                border: "1px solid #dadce0",
                boxShadow: "0 1px 6px rgba(32, 33, 36, 0.12)",
                fontFamily: "Arial, sans-serif",
              }}
            >
              <Stack gap={2}>
                <Flex align="center" style={{ gap: 8 }}>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: "50%",
                      backgroundColor: "#f1f3f4",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#5f6368",
                    }}
                  >
                    <Globe size={14} />
                  </div>
                  <Stack gap={1}>
                    <Text size={1} style={{ color: "#202124", fontWeight: 500, fontSize: 14 }}>
                      Roboto Blog
                    </Text>
                    <Text
                      size={1}
                      style={{
                        color: "#4d5156",
                        fontSize: 12,
                        lineHeight: "14px",
                        wordBreak: "break-all",
                      }}
                    >
                      {canonicalUrl}
                    </Text>
                  </Stack>
                </Flex>

                <a
                  href={canonicalUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    color: "#1a0dab",
                    fontSize: 20,
                    lineHeight: "26px",
                    fontWeight: 400,
                    textDecoration: "none",
                    cursor: "pointer",
                  }}
                  onMouseOver={(e) => (e.currentTarget.style.textDecoration = "underline")}
                  onMouseOut={(e) => (e.currentTarget.style.textDecoration = "none")}
                >
                  {effectiveTitle}
                </a>

                <p
                  style={{
                    margin: 0,
                    color: "#4d5156",
                    fontSize: 14,
                    lineHeight: "22px",
                    wordBreak: "break-word",
                  }}
                >
                  {effectiveDescription}
                </p>
              </Stack>
            </Card>

            <Flex justify="space-between" align="center">
              <Text size={1} muted>
                Title: <strong>{titleLength}</strong> chars • Description: <strong>{descLength}</strong> chars
              </Text>
              {Boolean(displayed.seoTitle) && (
                <Badge tone="caution" fontSize={1}>
                  SEO Title Override Active
                </Badge>
              )}
            </Flex>
          </Stack>
        </Card>

        {/* 2. SEO Health Checks & Audit */}
        <Card padding={4} radius={3} shadow={1} border>
          <Stack gap={4}>
            <Text size={2} weight="bold">
              SEO Health Checklist
            </Text>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
              {/* Check 1: Title Length */}
              <Card padding={3} radius={2} tone={titleStatus.tone} border>
                <Flex align="flex-start" style={{ gap: 12 }}>
                  {titleStatus.tone === "positive" ? (
                    <CheckCircle2 size={18} color="#22c55e" />
                  ) : (
                    <AlertTriangle size={18} color="#eab308" />
                  )}
                  <Stack gap={1}>
                    <Flex align="center" style={{ gap: 8 }}>
                      <Text size={1} weight="semibold">
                        Page Title Length
                      </Text>
                      <Badge tone={titleStatus.tone} fontSize={1}>
                        {titleLength} / 60
                      </Badge>
                    </Flex>
                    <Text size={1} muted>
                      {titleStatus.message}
                    </Text>
                  </Stack>
                </Flex>
              </Card>

              {/* Check 2: Description Length */}
              <Card padding={3} radius={2} tone={descStatus.tone} border>
                <Flex align="flex-start" style={{ gap: 12 }}>
                  {descStatus.tone === "positive" ? (
                    <CheckCircle2 size={18} color="#22c55e" />
                  ) : (
                    <AlertTriangle size={18} color="#eab308" />
                  )}
                  <Stack gap={1}>
                    <Flex align="center" style={{ gap: 8 }}>
                      <Text size={1} weight="semibold">
                        Meta Description
                      </Text>
                      <Badge tone={descStatus.tone} fontSize={1}>
                        {descLength} / 160
                      </Badge>
                    </Flex>
                    <Text size={1} muted>
                      {descStatus.message}
                    </Text>
                  </Stack>
                </Flex>
              </Card>

              {/* Check 3: Robots Indexing */}
              <Card padding={3} radius={2} tone={seoNoIndex ? "critical" : "positive"} border>
                <Flex align="flex-start" style={{ gap: 12 }}>
                  {seoNoIndex ? (
                    <XCircle size={18} color="#ef4444" />
                  ) : (
                    <CheckCircle2 size={18} color="#22c55e" />
                  )}
                  <Stack gap={1}>
                    <Flex align="center" style={{ gap: 8 }}>
                      <Text size={1} weight="semibold">
                        Robots Directives
                      </Text>
                      <Badge tone={seoNoIndex ? "critical" : "positive"} fontSize={1}>
                        {seoNoIndex ? "noindex" : "indexable"}
                      </Badge>
                    </Flex>
                    <Text size={1} muted>
                      {seoNoIndex
                        ? "Blocked: Page is set to 'Do Not Index' and will be excluded by search engines."
                        : "Allowed: Search engines are permitted to index this page."}
                    </Text>
                  </Stack>
                </Flex>
              </Card>

              {/* Check 4: List Visibility (Dedicated Check) */}
              <Card padding={3} radius={2} tone={seoHideFromLists ? "caution" : "positive"} border>
                <Flex align="flex-start" style={{ gap: 12 }}>
                  {seoHideFromLists ? (
                    <AlertTriangle size={18} color="#eab308" />
                  ) : (
                    <CheckCircle2 size={18} color="#22c55e" />
                  )}
                  <Stack gap={1}>
                    <Flex align="center" style={{ gap: 8 }}>
                      <Text size={1} weight="semibold">
                        List & Search Visibility
                      </Text>
                      <Badge tone={seoHideFromLists ? "caution" : "positive"} fontSize={1}>
                        {seoHideFromLists ? "Hidden from Lists" : "Visible"}
                      </Badge>
                    </Flex>
                    <Text size={1} muted>
                      {seoHideFromLists
                        ? "Hidden: This post is excluded from blog listings and search results (seoHideFromLists: true)."
                        : "Visible: This post appears in blog listing pages and search results."}
                    </Text>
                  </Stack>
                </Flex>
              </Card>

              {/* Check 5: Social Card Image */}
              <Card padding={3} radius={2} tone={hasImage ? "positive" : "caution"} border>
                <Flex align="flex-start" style={{ gap: 12 }}>
                  {hasImage ? (
                    <CheckCircle2 size={18} color="#22c55e" />
                  ) : (
                    <AlertTriangle size={18} color="#eab308" />
                  )}
                  <Stack gap={1}>
                    <Flex align="center" style={{ gap: 8 }}>
                      <Text size={1} weight="semibold">
                        Social & Listing Image
                      </Text>
                      <Badge tone={hasImage ? "positive" : "caution"} fontSize={1}>
                        {hasImage ? "Configured" : "Missing"}
                      </Badge>
                    </Flex>
                    <Text size={1} muted>
                      {hasImage
                        ? "Featured image is configured for rich social preview cards."
                        : "No image configured for search or social preview cards."}
                    </Text>
                  </Stack>
                </Flex>
              </Card>
            </div>
          </Stack>
        </Card>

        {/* 3. Algolia Search Index Status & Content Sync */}
        <Card padding={4} radius={3} shadow={1} border>
          <Stack gap={4}>
            <Flex justify="space-between" align="center">
              <Text size={2} weight="bold">
                Algolia Search Index & Content Sync
              </Text>
              <Text size={1} muted>
                Index: <code>blog</code> • Doc ID: <code>{cleanId}</code>
              </Text>
            </Flex>

            {algoliaStatus === "missing_config" && (
              <Card padding={3} radius={2} tone="critical" border>
                <Flex align="center" style={{ gap: 12 }}>
                  <XCircle size={18} color="#ef4444" />
                  <Text size={1}>
                    Missing Studio environment variables: <code>SANITY_STUDIO_ALGOLIA_APP_ID</code> and <code>SANITY_STUDIO_ALGOLIA_SEARCH_KEY</code> must be configured.
                  </Text>
                </Flex>
              </Card>
            )}

            {algoliaStatus === "loading" && (
              <Flex align="center" justify="center" style={{ gap: 12, padding: 16 }}>
                <Spinner muted />
                <Text size={1} muted>
                  Querying Algolia cluster...
                </Text>
              </Flex>
            )}

            {algoliaStatus === "indexed" && (
              <Stack gap={3}>
                {/* Content Match Status Banner */}
                <Card
                  padding={3}
                  radius={2}
                  tone={contentSyncEvaluation?.isInSync ? "positive" : "caution"}
                  border
                >
                  <Flex align="center" justify="space-between">
                    <Flex align="center" style={{ gap: 12 }}>
                      {contentSyncEvaluation?.isInSync ? (
                        <CheckCircle2 size={20} color="#22c55e" />
                      ) : (
                        <AlertTriangle size={20} color="#eab308" />
                      )}
                      <Stack gap={1}>
                        <Text size={2} weight="bold">
                          {contentSyncEvaluation?.isInSync
                            ? "Content Up to Date in Algolia"
                            : "Algolia Record Out of Sync"}
                        </Text>
                        <Text size={1} muted>
                          {contentSyncEvaluation?.message}
                        </Text>
                      </Stack>
                    </Flex>
                    <Badge
                      tone={contentSyncEvaluation?.isInSync ? "positive" : "caution"}
                      fontSize={1}
                    >
                      {contentSyncEvaluation?.isInSync ? "IN SYNC" : "OUT OF SYNC"}
                    </Badge>
                  </Flex>
                </Card>

                {/* Draft notification */}
                {hasUnpublishedEdits && (
                  <Card padding={3} radius={2} tone="caution" border>
                    <Flex align="center" style={{ gap: 12 }}>
                      <AlertTriangle size={18} color="#eab308" />
                      <Text size={1}>
                        <strong>Unpublished Draft Detected:</strong> You have active draft edits. Algolia currently reflects the published document. Publish to synchronize draft changes to search.
                      </Text>
                    </Flex>
                  </Card>
                )}

                {/* Detailed Comparison Table */}
                {algoliaRecord && (
                  <Card padding={3} radius={2} tone="transparent" style={{ backgroundColor: "#f8f9fa" }} border>
                    <Stack gap={3}>
                      <Text size={1} weight="semibold">
                        Content Verification: Sanity Published vs Algolia Record
                      </Text>

                      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr auto 1fr", gap: 8, alignItems: "center" }}>
                        <Text size={1} weight="bold" muted>FIELD</Text>
                        <Text size={1} weight="bold" muted>PUBLISHED (SANITY)</Text>
                        <span />
                        <Text size={1} weight="bold" muted>INDEXED (ALGOLIA)</Text>

                        {/* Title Row */}
                        <Text size={1} weight="semibold">Title</Text>
                        <Text size={1}>{publishedTitle || "—"}</Text>
                        <ArrowRight size={14} color="#888" />
                        <Flex align="center" style={{ gap: 6 }}>
                          <Text size={1}>{algoliaRecord.title || "—"}</Text>
                          {algoliaRecord.title === publishedTitle ? (
                            <CheckCircle2 size={14} color="#22c55e" />
                          ) : (
                            <AlertTriangle size={14} color="#eab308" />
                          )}
                        </Flex>

                        {/* Category Row */}
                        <Text size={1} weight="semibold">Category</Text>
                        <Text size={1}>{publishedCategory || "—"}</Text>
                        <ArrowRight size={14} color="#888" />
                        <Flex align="center" style={{ gap: 6 }}>
                          <Text size={1}>{algoliaRecord.category || "—"}</Text>
                          {algoliaRecord.category === publishedCategory ? (
                            <CheckCircle2 size={14} color="#22c55e" />
                          ) : (
                            <AlertTriangle size={14} color="#eab308" />
                          )}
                        </Flex>
                      </div>
                    </Stack>
                  </Card>
                )}
              </Stack>
            )}

            {algoliaStatus === "not_indexed" && (
              <Card padding={3} radius={2} tone={!isPublished ? "caution" : "critical"} border>
                <Flex align="flex-start" style={{ gap: 12 }}>
                  <XCircle size={20} color={!isPublished ? "#eab308" : "#ef4444"} />
                  <Stack gap={1}>
                    <Text size={2} weight="bold">
                      {!isPublished ? "Not Indexed (Unpublished Draft)" : "Not Found in Algolia Index"}
                    </Text>
                    <Text size={1} muted>
                      {!isPublished
                        ? "This document has never been published. Drafts are safely excluded from Algolia search by design."
                        : "This document is published in Sanity, but does not exist in the Algolia 'blog' index. Click 'Publish' to trigger synchronization."}
                    </Text>
                  </Stack>
                </Flex>
              </Card>
            )}

            {algoliaStatus === "error" && (
              <Card padding={3} radius={2} tone="critical" border>
                <Flex align="center" style={{ gap: 12 }}>
                  <XCircle size={18} color="#ef4444" />
                  <Text size={1}>
                    Unable to query Algolia search API. Please verify network connectivity and credentials.
                  </Text>
                </Flex>
              </Card>
            )}
          </Stack>
        </Card>
      </Stack>
    </Box>
  );
}
