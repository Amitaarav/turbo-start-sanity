import type { Blog } from "@/types";

export interface SanityBlogDocument {
  _id: string;
  _createdAt: string;
  title: string;
  description?: string;
  slug?: string;
  category?: string;
  publishedAt?: string;
  featured?: boolean;
  image?: {
    id?: string;
    url?: string;
    alt?: string;
  };
  authors?: Array<{
    _id: string;
    name: string;
    position?: string;
  }>;
}

export interface AlgoliaBlogRecord {
  [key: string]: unknown;
  objectID: string;
  title: string;
  description: string;
  slug: string;
  category: string;
  publishedAt: string;
  featured: boolean;
  authorName: string;
  authorId: string;
  authorPosition: string;
  imageId: string;
  imageUrl: string;
  imageAlt: string;
}

export function toAlgoliaBlogRecord(document: SanityBlogDocument): AlgoliaBlogRecord {
  const author = document.authors?.[0];

  return {
    objectID: document._id,
    title: document.title,
    description: document.description ?? "",
    slug: document.slug ?? "",
    category: document.category ?? "",
    publishedAt: document.publishedAt ?? document._createdAt,
    featured: document.featured ?? false,
    authorName: author?.name ?? "",
    authorId: author?._id ?? "",
    authorPosition: author?.position ?? "",
    imageId: document.image?.id ?? "",
    imageUrl: document.image?.url ?? "",
    imageAlt: document.image?.alt ?? "",
  };
}

export function algoliaRecordToBlog(record: AlgoliaBlogRecord): Blog {
  return {
    _id: record.objectID,
    _type: "blog",
    title: record.title,
    description: record.description || null,
    slug: record.slug || null,
    category: record.category || null,
    publishedAt: record.publishedAt || null,
    featured: record.featured ?? false,
    image: record.imageId
      ? {
          id: record.imageId,
          alt: record.imageAlt || record.title,
        }
      : null,
    authors: record.authorName
      ? [
          {
            _id: record.authorId || "author",
            name: record.authorName,
            position: record.authorPosition || "",
          },
        ]
      : [],
  } as unknown as Blog;
}
