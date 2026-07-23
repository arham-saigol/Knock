"use node";

import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import {
  discoverUsefulLinks,
  extractEmailCandidates,
  isAllowedContactEmail,
  type EmailCandidate,
} from "./lib/emailDiscovery";
import { runContactAgent, scrapeWithFirecrawl } from "./lib/firecrawl";
import { normalizeOfficialWebsiteUrl } from "./lib/productHunt";
import { capText, errorMessage } from "./lib/strings";
import { isPastDraftStart, pktDay } from "./lib/time";
import { tinyFishFetch, tinyFishSearch } from "./lib/tinyfish";
import { isSameRootDomain, normalizeWebsiteUrl } from "./lib/urls";

type Page = {
  url: string;
  title?: string;
  html?: string;
  markdown?: string;
  source: "tinyfish" | "firecrawl";
};

const boilerplate =
  /^(accept (all )?cookies|cookie (settings|policy)|privacy preferences|skip to content|all rights reserved|subscribe to our newsletter)$/i;

export function cleanScrapedMarkdown(markdown: string) {
  const counts = new Map<string, number>();
  const result: string[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const normalized = line.replace(/\s+/g, " ").trim();
    if (normalized && boilerplate.test(normalized)) continue;
    const count = counts.get(normalized) ?? 0;
    if (normalized && count >= 2) continue;
    if (normalized) counts.set(normalized, count + 1);
    result.push(line);
  }
  return result
    .join("\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function mergeTinyFishResults(
  pages: Map<string, Page>,
  results: Awaited<ReturnType<typeof tinyFishFetch>>,
  field: "html" | "markdown",
) {
  for (const result of results) {
    const url = normalizeWebsiteUrl(result.final_url ?? result.url);
    if (!url || !result.text) continue;
    const page = pages.get(url) ?? { url, source: "tinyfish" as const };
    page.title ??= result.title;
    page[field] = result.text;
    pages.set(url, page);
  }
}

async function addFirecrawlPage(pages: Map<string, Page>, url: string) {
  const result = await scrapeWithFirecrawl(url);
  const finalUrl =
    normalizeWebsiteUrl(
      result.metadata?.url ?? result.metadata?.sourceURL ?? url,
    ) ?? url;
  const page = pages.get(finalUrl) ?? {
    url: finalUrl,
    source: "firecrawl" as const,
  };
  page.title ??= result.metadata?.title;
  page.html ??= result.html;
  page.markdown ??= result.markdown;
  page.source = "firecrawl";
  pages.set(finalUrl, page);
  return result.links ?? [];
}

async function researchWebsite(websiteUrl: string) {
  const pages = new Map<string, Page>();
  let discoveredLinks: string[] = [];
  try {
    const htmlResults = await tinyFishFetch([websiteUrl], "html");
    mergeTinyFishResults(pages, htmlResults, "html");
    const homepage = [...pages.values()][0];
    if (!homepage?.html || homepage.html.length < 400)
      throw new Error("TinyFish returned too little content");
    discoveredLinks = discoverUsefulLinks(homepage.html, homepage.url);
  } catch {
    discoveredLinks = await addFirecrawlPage(pages, websiteUrl);
  }

  const homepage = [...pages.values()][0];
  if (!homepage) throw new Error("The launch website could not be fetched");
  const usefulLinks = discoveredLinks
    .map((link) => normalizeWebsiteUrl(link))
    .filter((link): link is string =>
      Boolean(link && isSameRootDomain(link, homepage.url)),
    )
    .filter((link, index, links) => links.indexOf(link) === index)
    .slice(0, 4);
  const focusedUrls = [homepage.url, ...usefulLinks];

  const [markdownResult, htmlResult] = await Promise.allSettled([
    tinyFishFetch(focusedUrls, "markdown"),
    usefulLinks.length
      ? tinyFishFetch(usefulLinks, "html")
      : Promise.resolve([]),
  ]);
  if (markdownResult.status === "fulfilled") {
    mergeTinyFishResults(pages, markdownResult.value, "markdown");
  }
  if (htmlResult.status === "fulfilled") {
    mergeTinyFishResults(pages, htmlResult.value, "html");
  }
  await Promise.all(
    focusedUrls.map(async (url) => {
      const page = [...pages.values()].find(
        (candidate) => candidate.url === url,
      );
      if (page?.markdown && page.markdown.length >= 200) return;
      try {
        await addFirecrawlPage(pages, url);
      } catch {
        return;
      }
    }),
  );
  return pages;
}

function findBestCandidate(pages: Iterable<Page>): EmailCandidate | undefined {
  const candidates: EmailCandidate[] = [];
  for (const page of pages) {
    candidates.push(
      ...extractEmailCandidates({
        html: page.html,
        markdown: page.markdown,
        sourceUrl: page.url,
      }),
    );
  }
  return candidates
    .filter((candidate) => {
      const emailDomain = candidate.email.split("@")[1];
      if (!emailDomain) return false;
      if (isSameRootDomain(`https://${emailDomain}`, candidate.sourceUrl))
        return true;
      const localPart = candidate.email.split("@")[0];
      return (
        !/^(hello|hi|contact|info|team|partners?|partnerships?|sales|support)$/i.test(
          localPart,
        ) &&
        /\b(founder|co-founder|cofounder|ceo|maker)\b/i.test(candidate.context)
      );
    })
    .sort(
      (left, right) =>
        right.score - left.score || left.email.localeCompare(right.email),
    )[0];
}

async function searchForContact(pages: Map<string, Page>, websiteUrl: string) {
  const hostname = new URL(websiteUrl).hostname;
  const results = await tinyFishSearch(
    `site:${hostname} (contact OR founder OR team OR partnerships) email`,
  );
  const urls = results
    .map((result) => normalizeWebsiteUrl(result.url))
    .filter((url): url is string =>
      Boolean(url && isSameRootDomain(url, websiteUrl)),
    )
    .filter((url, index, values) => values.indexOf(url) === index)
    .slice(0, 3);
  if (!urls.length) return undefined;
  const [htmlResult, markdownResult] = await Promise.allSettled([
    tinyFishFetch(urls, "html"),
    tinyFishFetch(urls, "markdown"),
  ]);
  if (htmlResult.status === "fulfilled") {
    mergeTinyFishResults(pages, htmlResult.value, "html");
  }
  if (markdownResult.status === "fulfilled") {
    mergeTinyFishResults(pages, markdownResult.value, "markdown");
  }
  await Promise.all(
    urls.map(async (url) => {
      const page = [...pages.values()].find(
        (candidate) => candidate.url === url,
      );
      if (page?.html || page?.markdown) return;
      try {
        await addFirecrawlPage(pages, url);
      } catch {
        return;
      }
    }),
  );
  return findBestCandidate(pages.values());
}

function buildMarkdown(pages: Iterable<Page>) {
  const sections = [...pages]
    .filter((page) => page.markdown)
    .map(
      (page) =>
        `SOURCE: ${page.url}\n${capText(cleanScrapedMarkdown(page.markdown ?? ""), 25_000)}`,
    );
  return capText(sections.join("\n\n--- PAGE BREAK ---\n\n"), 80_000);
}

export const processLaunch = internalAction({
  args: { projectLaunchId: v.id("projectLaunches") },
  handler: async (ctx, args) => {
    const researchStartedAt = await ctx.runMutation(
      internal.researchData.claim,
      args,
    );
    if (researchStartedAt === null) return;
    const bundle = await ctx.runQuery(internal.researchData.bundle, args);
    if (bundle?.projectLaunch.researchStartedAt !== researchStartedAt) return;
    try {
      const launchWebsite = normalizeOfficialWebsiteUrl(
        bundle.launch.websiteUrl,
      );
      if (!launchWebsite)
        throw new Error("Product Hunt did not provide a launch website");
      const pages = await researchWebsite(launchWebsite);
      const homepage = [...pages.values()][0];
      const websiteUrl = homepage?.url ?? launchWebsite;
      let candidate = findBestCandidate(pages.values());
      let contactSource: "website" | "search" | undefined = candidate
        ? "website"
        : undefined;

      if (!candidate) {
        try {
          candidate = await searchForContact(pages, websiteUrl);
          if (candidate) contactSource = "search";
        } catch (error) {
          console.error("TinyFish contact search failed", error);
        }
      }

      const scrapeMarkdown = buildMarkdown(pages.values());
      if (scrapeMarkdown.length < 200)
        throw new Error("The website returned too little useful content");
      const scrapedPages = [...pages.values()].map((page) => ({
        url: page.url,
        title: page.title,
        source: page.source,
      }));
      if (!candidate) {
        await ctx.runMutation(internal.researchData.savePendingAgent, {
          projectLaunchId: bundle.projectLaunch._id,
          researchStartedAt,
          scrapeMarkdown,
          scrapedPages,
        });
        return;
      }
      await ctx.runMutation(internal.researchData.save, {
        projectLaunchId: bundle.projectLaunch._id,
        researchStartedAt,
        scrapeMarkdown,
        scrapedPages,
        contactEmail: candidate.email,
        contactSourceUrl: candidate.sourceUrl,
        contactSource,
        contactEvidence: candidate.context,
        generateNow: bundle.run.kind === "late" || isPastDraftStart(),
      });
    } catch (error) {
      await ctx.runMutation(internal.researchData.fail, {
        projectLaunchId: bundle.projectLaunch._id,
        researchStartedAt,
        error: errorMessage(error),
      });
    }
  },
});

export const resolveContact = internalAction({
  args: {
    projectLaunchId: v.id("projectLaunches"),
    contactStartedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const bundle = await ctx.runQuery(internal.researchData.bundle, args);
    if (
      !bundle ||
      bundle.projectLaunch.stage !== "contact" ||
      bundle.projectLaunch.contactStartedAt !== args.contactStartedAt
    )
      return;
    let email: string | undefined;
    let sourceUrl: string | undefined;
    let evidence: string | undefined;
    const launchWebsite = normalizeOfficialWebsiteUrl(bundle.launch.websiteUrl);
    if (!launchWebsite) {
      await ctx.runMutation(internal.researchData.finishAgent, {
        projectLaunchId: bundle.projectLaunch._id,
        contactStartedAt: args.contactStartedAt,
        generateNow: false,
      });
      return;
    }
    const contactStartedAt = await ctx.runMutation(
      internal.researchData.claimFirecrawlAgent,
      {
        projectLaunchId: bundle.projectLaunch._id,
        contactStartedAt: args.contactStartedAt,
        day: pktDay(),
      },
    );
    if (contactStartedAt === null) return;
    try {
      const result = await runContactAgent({
        name: bundle.launch.name,
        websiteUrl: launchWebsite,
      });
      const candidateEmail =
        typeof result?.email === "string"
          ? result.email.trim().toLowerCase()
          : "";
      const candidateSource =
        typeof result?.sourceUrl === "string"
          ? normalizeWebsiteUrl(result.sourceUrl)
          : undefined;
      if (
        candidateEmail &&
        candidateSource &&
        isAllowedContactEmail(candidateEmail) &&
        isSameRootDomain(candidateSource, launchWebsite)
      ) {
        email = candidateEmail;
        sourceUrl = candidateSource;
        evidence = "Published business contact found by Firecrawl Agent";
      }
    } catch (error) {
      console.error("Firecrawl contact Agent failed", error);
    }
    await ctx.runMutation(internal.researchData.finishAgent, {
      projectLaunchId: bundle.projectLaunch._id,
      contactStartedAt,
      contactEmail: email,
      contactSourceUrl: sourceUrl,
      contactEvidence: evidence,
      generateNow: bundle.run.kind === "late" || isPastDraftStart(),
    });
  },
});
