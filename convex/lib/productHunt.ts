"use node";

import * as cheerio from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

import { productHuntDayBounds } from "./time";
import { normalizeWebsiteUrl } from "./urls";

const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();
const withUrlResolutionLimit = createLimiter(5);

function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function limit<T>(operation: () => Promise<T>) {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    active += 1;
    try {
      return await operation();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export async function assertPublicHttpUrl(
  value: string,
  resolveAddresses: (
    hostname: string,
  ) => Promise<Array<{ address: string; family: number }>> = (hostname) =>
    lookup(hostname, { all: true, verbatim: true }),
) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Redirect target must use HTTP or HTTPS");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Redirect target must be public");
  }
  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolveAddresses(hostname);
  if (
    addresses.length === 0 ||
    addresses.some(({ address, family }) =>
      family === 6
        ? blockedIpv6Addresses.check(address, "ipv6")
        : blockedIpv4Addresses.check(address, "ipv4"),
    )
  ) {
    throw new Error("Redirect target resolved to a non-public address");
  }
  return { url, addresses };
}

export function requestPinnedHttpUrl(
  url: URL,
  addresses: { address: string; family: number }[],
  requestOverride?: typeof httpRequest,
) {
  return new Promise<{ status: number; location?: string }>(
    (resolve, reject) => {
      const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
        if (options.all) {
          callback(null, addresses);
          return;
        }
        const [address] = addresses;
        if (!address) {
          callback(new Error("No validated address available"), "");
          return;
        }
        callback(null, address.address, address.family);
      };
      const requestFunction =
        requestOverride ??
        (url.protocol === "https:" ? httpsRequest : httpRequest);
      const request = requestFunction(
        url,
        {
          method: "GET",
          headers: {
            "User-Agent": "Knock/1.0 (+private outreach research app)",
          },
          signal: AbortSignal.timeout(20_000),
          lookup: pinnedLookup,
        },
        (response) => {
          const status = response.statusCode ?? 0;
          const location = response.headers.location;
          response.destroy();
          resolve({ status, location });
        },
      );
      request.once("error", reject);
      request.end();
    },
  );
}

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
        posts.nodes.map((post) =>
          withUrlResolutionLimit(async (): Promise<ProductHuntLaunch> => {
            const officialWebsiteUrl = await resolveProductUrl(
              post.id,
              post.website,
            );
            const websiteUrl =
              officialWebsiteUrl ?? normalizeOfficialWebsiteUrl(post.website);
            return {
              productHuntId: post.id,
              name: post.name.trim(),
              tagline: post.tagline.trim(),
              description: post.description?.trim() ?? "",
              topics:
                post.topics?.nodes
                  ?.map((topic) => topic.name)
                  .filter(Boolean) ?? [],
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
        ),
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
    let currentUrl = new URL(redirectUrl);
    for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
      const validated = await assertPublicHttpUrl(currentUrl.toString());
      currentUrl = validated.url;
      const response = await requestPinnedHttpUrl(
        currentUrl,
        validated.addresses,
      );
      if (response.status < 300 || response.status >= 400) {
        return normalizeOfficialWebsiteUrl(currentUrl.toString());
      }
      const { location } = response;
      if (!location || redirectCount === 5) return undefined;
      currentUrl = new URL(location, currentUrl);
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function normalizeOfficialWebsiteUrl(url?: string) {
  const normalized = url ? normalizeWebsiteUrl(url) : undefined;
  if (!normalized) return undefined;
  const hostname = new URL(normalized).hostname
    .toLowerCase()
    .replace(/\.$/, "");
  if (hostname === "producthunt.com" || hostname.endsWith(".producthunt.com"))
    return undefined;
  return normalized;
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
    matching.map((entry) =>
      withUrlResolutionLimit(async (): Promise<ProductHuntLaunch> => {
        const id = entry.id?.match(/Post\/(\d+)/)?.[1];
        const $ = cheerio.load(entry.content ?? "");
        const paragraphs = $("p")
          .map((_index, element) =>
            $(element).text().replace(/\s+/g, " ").trim(),
          )
          .get()
          .filter(Boolean);
        const fallbackUrl = firstLink(entry) ?? "https://www.producthunt.com";
        const productHuntUrl = normalizeWebsiteUrl(fallbackUrl) ?? fallbackUrl;
        const officialWebsiteUrl = id ? await resolveProductUrl(id) : undefined;
        return {
          productHuntId: id,
          name: entry.title?.trim() || "Untitled launch",
          tagline: paragraphs[0] ?? "",
          description: paragraphs[0] ?? "",
          topics: [],
          websiteUrl: officialWebsiteUrl,
          canonicalWebsiteUrl: officialWebsiteUrl,
          makers: entry.author?.name ? [{ name: entry.author.name }] : [],
          productHuntUrl,
          launchedAt: new Date(entry.published ?? Date.now()).getTime(),
          launchDay: day,
          source: "rss",
        };
      }),
    ),
  );
}
