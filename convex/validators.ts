import { v } from "convex/values";

export const brandContextValidator = v.object({
  whatItDoes: v.string(),
  audience: v.array(v.string()),
  problemsSolved: v.array(v.string()),
  benefits: v.array(v.string()),
  differentiators: v.array(v.string()),
  offers: v.array(v.string()),
  outreachAngles: v.array(v.string()),
  prohibitedClaims: v.array(v.string()),
});

export const projectStatusValidator = v.union(
  v.literal("building"),
  v.literal("ready"),
  v.literal("failed"),
);

export const skipRetentionValidator = v.union(
  v.literal("delete"),
  v.literal("30"),
  v.literal("60"),
  v.literal("forever"),
);

export const launchStatusValidator = v.union(
  v.literal("processing"),
  v.literal("ready"),
  v.literal("no_email"),
  v.literal("sent"),
  v.literal("skipped"),
  v.literal("failed"),
  v.literal("filtered"),
);

export const processingStageValidator = v.union(
  v.literal("filtering"),
  v.literal("scraping"),
  v.literal("contact"),
  v.literal("drafting"),
  v.literal("review"),
  v.literal("complete"),
);

export const syncKindValidator = v.union(
  v.literal("main"),
  v.literal("late"),
  v.literal("manual"),
);

export const syncStatusValidator = v.union(
  v.literal("running"),
  v.literal("completed"),
  v.literal("partial"),
  v.literal("failed"),
);

export const sourceValidator = v.union(v.literal("api"), v.literal("rss"));

export const scrapedPageValidator = v.object({
  url: v.string(),
  title: v.optional(v.string()),
  source: v.union(v.literal("tinyfish"), v.literal("firecrawl")),
});

export const contactSourceValidator = v.union(
  v.literal("website"),
  v.literal("search"),
  v.literal("firecrawl_agent"),
);

export const emptyBrandContext = {
  whatItDoes: "",
  audience: [] as string[],
  problemsSolved: [] as string[],
  benefits: [] as string[],
  differentiators: [] as string[],
  offers: [] as string[],
  outreachAngles: [] as string[],
  prohibitedClaims: [] as string[],
};
