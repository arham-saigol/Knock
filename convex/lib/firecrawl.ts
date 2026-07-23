import { capText } from "./strings";

const API_ROOT = "https://api.firecrawl.dev/v2";

type CrawlPage = {
  markdown?: string;
  metadata?: {
    sourceURL?: string;
    url?: string;
    title?: string;
    statusCode?: number;
  };
};

type CrawlStatus = {
  status?: string;
  data?: CrawlPage[];
  next?: string | null;
  error?: string;
};

function apiKey() {
  const value = process.env.FIRECRAWL_API_KEY;
  if (!value) throw new Error("FIRECRAWL_API_KEY is not configured");
  return value;
}

async function firecrawlFetch(pathOrUrl: string, init?: RequestInit) {
  const url = pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${API_ROOT}${pathOrUrl}`;
  const response = await fetch(url, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(100_000),
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    const detail =
      typeof payload.error === "string" ? payload.error : response.statusText;
    throw new Error(`Firecrawl ${response.status}: ${detail}`);
  }
  return payload;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function crawlProjectWebsite(url: string) {
  const started = await firecrawlFetch("/crawl", {
    method: "POST",
    body: JSON.stringify({
      url,
      limit: 20,
      maxDiscoveryDepth: 2,
      crawlEntireDomain: true,
      allowExternalLinks: false,
      ignoreQueryParameters: true,
      scrapeOptions: {
        formats: ["markdown"],
        onlyMainContent: true,
        blockAds: true,
        maxAge: 0,
      },
    }),
  });
  const id = typeof started.id === "string" ? started.id : undefined;
  if (!id) throw new Error("Firecrawl did not return a crawl ID");

  const deadline = Date.now() + 240_000;
  let status: CrawlStatus = {};
  while (Date.now() < deadline) {
    status = (await firecrawlFetch(`/crawl/${id}`)) as CrawlStatus;
    if (status.status === "completed") break;
    if (status.status === "failed" || status.status === "cancelled") {
      throw new Error(status.error ?? `Firecrawl crawl ${status.status}`);
    }
    await sleep(2_000);
  }
  if (status.status !== "completed")
    throw new Error("Firecrawl project crawl timed out");

  const pages = [...(status.data ?? [])];
  let next = status.next;
  while (next && pages.length < 20) {
    const page = (await firecrawlFetch(next)) as CrawlStatus;
    pages.push(...(page.data ?? []));
    next = page.next;
  }

  const content = pages
    .filter(
      (page) =>
        page.markdown &&
        (!page.metadata?.statusCode || page.metadata.statusCode < 400),
    )
    .map((page) => {
      const source = page.metadata?.sourceURL ?? page.metadata?.url ?? url;
      return `SOURCE: ${source}\n${page.markdown}`;
    })
    .join("\n\n--- PAGE BREAK ---\n\n");
  if (content.trim().length < 200)
    throw new Error("Project crawl returned too little content");
  return capText(content, 120_000);
}

export async function createProjectMonitor({
  projectId,
  projectName,
  url,
}: {
  projectId: string;
  projectName: string;
  url: string;
}) {
  const siteUrl = process.env.CONVEX_SITE_URL;
  if (!siteUrl) throw new Error("CONVEX_SITE_URL is not configured");

  const result = await firecrawlFetch("/monitor", {
    method: "POST",
    body: JSON.stringify({
      name: `${projectName} brand context`,
      schedule: { text: "weekly", timezone: "Asia/Karachi" },
      goal: "Report material changes to the product, audience, benefits, offers, differentiators, or defensible claims.",
      judgeEnabled: true,
      retentionDays: 60,
      webhook: {
        url: `${siteUrl.replace(/\/$/, "")}/firecrawl-monitor`,
        events: ["monitor.check.completed"],
        metadata: { projectId },
      },
      targets: [
        {
          type: "crawl",
          url,
          crawlOptions: {
            limit: 20,
            maxDiscoveryDepth: 2,
            crawlEntireDomain: true,
            ignoreQueryParameters: true,
          },
          scrapeOptions: {
            formats: [
              "markdown",
              { type: "changeTracking", modes: ["git-diff"] },
            ],
            onlyMainContent: true,
            blockAds: true,
            maxAge: 0,
          },
        },
      ],
    }),
  });
  const data = result.data as Record<string, unknown> | undefined;
  const id = typeof data?.id === "string" ? data.id : undefined;
  if (!id) throw new Error("Firecrawl did not return a monitor ID");
  return id;
}

export async function deleteProjectMonitor(monitorId: string) {
  try {
    await firecrawlFetch(`/monitor/${encodeURIComponent(monitorId)}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes(" 404:")) return;
    throw error;
  }
}

export async function scrapeWithFirecrawl(url: string) {
  const result = await firecrawlFetch("/scrape", {
    method: "POST",
    body: JSON.stringify({
      url,
      formats: ["markdown", "html", "links"],
      onlyMainContent: false,
      blockAds: true,
      maxAge: 86_400_000,
      timeout: 60_000,
    }),
  });
  return result.data as {
    markdown?: string;
    html?: string;
    links?: string[];
    metadata?: {
      sourceURL?: string;
      url?: string;
      title?: string;
      statusCode?: number;
    };
  };
}

export async function runContactAgent({
  name,
  websiteUrl,
}: {
  name: string;
  websiteUrl: string;
}) {
  const started = await firecrawlFetch("/agent", {
    method: "POST",
    body: JSON.stringify({
      urls: [websiteUrl],
      prompt: `Find one publicly listed business contact email for ${name} from its official website. Prefer a named founder or team member, then partnerships, hello/contact, sales, or support. Reject privacy, legal, abuse, security, noreply, and automated addresses. Do not infer or guess an address. Return null when no published address exists. Include the exact official source URL.`,
      model: "spark-1-mini",
      maxCredits: 100,
      schema: {
        type: "object",
        properties: {
          email: { type: ["string", "null"] },
          sourceUrl: { type: ["string", "null"] },
        },
        required: ["email", "sourceUrl"],
      },
    }),
  });

  const immediateStatus =
    typeof started.status === "string" ? started.status : undefined;
  if (immediateStatus === "completed")
    return started.data as Record<string, unknown> | undefined;
  const id = typeof started.id === "string" ? started.id : undefined;
  if (!id) throw new Error("Firecrawl did not return an Agent job ID");

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const status = await firecrawlFetch(`/agent/${id}`);
    if (status.status === "completed")
      return status.data as Record<string, unknown> | undefined;
    if (status.status === "failed" || status.status === "cancelled") {
      throw new Error(
        typeof status.error === "string"
          ? status.error
          : `Firecrawl Agent ${status.status}`,
      );
    }
    await sleep(2_000);
  }
  throw new Error("Firecrawl Agent timed out");
}

export async function getMonitorCheck(monitorId: string, checkId: string) {
  const pages: Array<Record<string, unknown>> = [];
  let next: string | null =
    `/monitor/${encodeURIComponent(monitorId)}/checks/${encodeURIComponent(checkId)}?limit=100`;
  let check: Record<string, unknown> | undefined;
  while (next && pages.length < 500) {
    const result = await firecrawlFetch(next);
    const data = result.data as Record<string, unknown> | undefined;
    check ??= data;
    if (Array.isArray(data?.pages))
      pages.push(...(data.pages as Array<Record<string, unknown>>));
    next =
      typeof result.next === "string"
        ? result.next
        : typeof data?.next === "string"
          ? data.next
          : null;
  }
  return { check, pages };
}
