import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";

import { productHuntDayBounds } from "./time";
import { normalizeWebsiteUrl } from "./urls";

export type ProductHuntLaunch = {
  productHuntId?: string;
  name: string;
  tagline: string;
  description: string;
  topics: string[];
  websiteUrl?: string;
  canonicalWebsiteUrl?: string;
  thumbnailUrl?: string;
  makers: Array<{ name: string; username?: string; imageUrl?: string }>;
  productHuntUrl: string;
  launchedAt: number;
  launchDay: string;
  source: "api" | "rss";
};

type GraphPost = {
  id: string;
  name: string;
  tagline: string;
  description?: string | null;
  website: string;
  url: string;
  createdAt: string;
  thumbnail?: { url?: string } | null;
  topics?: { nodes?: Array<{ name: string }> };
  makers?: Array<{
    name: string;
    username?: string;
    profileImage?: string | null;
  }>;
};

type GraphResponse = {
  data?: {
    posts?: {
      nodes?: GraphPost[];
      pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    };
  };
  errors?: Array<{ message?: string }>;
};

const postsQuery = `
  query DailyPosts($after: String, $postedAfter: DateTime!, $postedBefore: DateTime!) {
    posts(
      first: 50
      after: $after
      postedAfter: $postedAfter
      postedBefore: $postedBefore
      order: NEWEST
    ) {
      nodes {
        id
        name
        tagline
        description
        website
        url
        createdAt
        thumbnail { url(width: 160, height: 160) }
        topics(first: 20) { nodes { name } }
        makers { name username profileImage(size: 80) }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function fetchProductHuntApi(day: string) {
  const token = process.env.PRODUCT_HUNT_TOKEN;
  if (!token) throw new Error("PRODUCT_HUNT_TOKEN is not configured");
  const { start, end } = productHuntDayBounds(day);
  const launches: ProductHuntLaunch[] = [];
  let after: string | null = null;
  const seenCursors = new Set<string>();

  do {
    const response = await fetch("https://api.producthunt.com/v2/api/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: postsQuery,
        variables: {
          after,
          postedAfter: start.toISOString(),
          postedBefore: end.toISOString(),
        },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => ({}))) as GraphResponse;
    if (!response.ok || payload.errors?.length) {
      throw new Error(
        payload.errors
          ?.map((error) => error.message)
          .filter(Boolean)
          .join("; ") || `Product Hunt API returned ${response.status}`,
      );
    }
    const posts = payload.data?.posts;
    if (!posts || !Array.isArray(posts.nodes)) {
      throw new Error("Product Hunt API returned a malformed posts response");
    }
    launches.push(
      ...(await Promise.all(
        posts.nodes.map(async (post): Promise<ProductHuntLaunch> => {
          const officialWebsiteUrl = await resolveProductUrl(
            post.id,
            post.website,
          );
          const websiteUrl =
            officialWebsiteUrl ?? normalizeWebsiteUrl(post.website);
          return {
            productHuntId: post.id,
            name: post.name.trim(),
            tagline: post.tagline.trim(),
            description: post.description?.trim() ?? "",
            topics:
              post.topics?.nodes?.map((topic) => topic.name).filter(Boolean) ??
              [],
            websiteUrl,
            canonicalWebsiteUrl: officialWebsiteUrl,
            thumbnailUrl: post.thumbnail?.url,
            makers:
              post.makers?.map((maker) => ({
                name: maker.name,
                username: maker.username,
                imageUrl: maker.profileImage ?? undefined,
              })) ?? [],
            productHuntUrl: normalizeWebsiteUrl(post.url) ?? post.url,
            launchedAt: new Date(post.createdAt).getTime(),
            launchDay: day,
            source: "api",
          };
        }),
      )),
    );
    if (posts.pageInfo?.hasNextPage) {
      const nextCursor = posts.pageInfo.endCursor;
      if (!nextCursor || seenCursors.has(nextCursor)) {
        throw new Error("Product Hunt API pagination did not advance");
      }
      seenCursors.add(nextCursor);
      after = nextCursor;
    } else {
      after = null;
    }
  } while (after);

  return launches;
}

type FeedEntry = {
  id?: string;
  title?: string;
  published?: string;
  content?: string;
  link?: { "@_href"?: string } | Array<{ "@_href"?: string }>;
  author?: { name?: string };
};

function firstLink(entry: FeedEntry) {
  const links = Array.isArray(entry.link)
    ? entry.link
    : entry.link
      ? [entry.link]
      : [];
  return links.map((link) => link["@_href"]).find(Boolean);
}

async function resolveProductUrl(
  productHuntId: string,
  redirectUrl = `https://www.producthunt.com/r/p/${productHuntId}?app_id=339`,
) {
  try {
    const response = await fetch(redirectUrl, {
      redirect: "follow",
      headers: { "User-Agent": "Knock/1.0 (+private outreach research app)" },
      signal: AbortSignal.timeout(20_000),
    });
    const resolved = normalizeWebsiteUrl(response.url);
    if (resolved && !new URL(resolved).hostname.endsWith("producthunt.com"))
      return resolved;
  } catch {
    return undefined;
  }
  return undefined;
}

export async function fetchProductHuntRss(day: string) {
  const response = await fetch("https://www.producthunt.com/feed", {
    headers: { "User-Agent": "Knock/1.0 (+private outreach research app)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok)
    throw new Error(`Product Hunt RSS returned ${response.status}`);
  const xml = await response.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const feed = parser.parse(xml) as {
    feed?: { entry?: FeedEntry | FeedEntry[] };
  };
  const entries = Array.isArray(feed.feed?.entry)
    ? feed.feed.entry
    : feed.feed?.entry
      ? [feed.feed.entry]
      : [];
  const { start, end } = productHuntDayBounds(day);
  const matching = entries.filter((entry) => {
    const published = new Date(entry.published ?? "").getTime();
    return (
      Number.isFinite(published) &&
      published >= start.getTime() &&
      published <= end.getTime()
    );
  });
  if (matching.length === 0) {
    throw new Error(
      "Product Hunt RSS did not contain launches for the current Product Hunt day",
    );
  }

  return Promise.all(
    matching.map(async (entry): Promise<ProductHuntLaunch> => {
      const id = entry.id?.match(/Post\/(\d+)/)?.[1];
      const $ = cheerio.load(entry.content ?? "");
      const paragraphs = $("p")
        .map((_index, element) => $(element).text().replace(/\s+/g, " ").trim())
        .get()
        .filter(Boolean);
      const fallbackUrl = firstLink(entry) ?? "https://www.producthunt.com";
      const productHuntUrl = normalizeWebsiteUrl(fallbackUrl) ?? fallbackUrl;
      const officialWebsiteUrl = id ? await resolveProductUrl(id) : undefined;
      const websiteUrl =
        officialWebsiteUrl ??
        (id
          ? normalizeWebsiteUrl(
              `https://www.producthunt.com/r/p/${id}?app_id=339`,
            )
          : undefined);
      return {
        productHuntId: id,
        name: entry.title?.trim() || "Untitled launch",
        tagline: paragraphs[0] ?? "",
        description: paragraphs[0] ?? "",
        topics: [],
        websiteUrl,
        canonicalWebsiteUrl: officialWebsiteUrl,
        makers: entry.author?.name ? [{ name: entry.author.name }] : [],
        productHuntUrl,
        launchedAt: new Date(entry.published ?? Date.now()).getTime(),
        launchDay: day,
        source: "rss",
      };
    }),
  );
}
