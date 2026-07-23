import * as cheerio from "cheerio";

const emailPattern =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
const exactEmailPattern =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const obfuscatedEmailPattern =
  /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+\s*(?:\[at\]|\(at\)|\sat\s)\s*[a-z0-9-]+(?:\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*[a-z0-9-]+)+/gi;
const rejectedLocalParts =
  /^(privacy|legal|abuse|security|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|automated|notifications?|alerts?)$/i;
const usefulPath =
  /\b(contact|about|team|company|partner|partnership|legal|imprint)\b/i;

export type EmailCandidate = {
  email: string;
  sourceUrl: string;
  context: string;
  score: number;
};

function normalizeObfuscation(text: string) {
  return text
    .replace(/\s*(?:\[at\]|\(at\)|\sat\s)\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\)|\sdot\s)\s*/gi, ".");
}

function isRejected(email: string) {
  const [localPart] = email.toLowerCase().split("@");
  return !localPart || rejectedLocalParts.test(localPart);
}

function scoreCandidate(email: string, sourceUrl: string, context: string) {
  const localPart = email.split("@")[0].toLowerCase();
  const evidence = `${sourceUrl} ${context}`.toLowerCase();
  const generic =
    /^(hello|hi|contact|info|team|partners?|partnerships?|sales|support)$/i.test(
      localPart,
    );
  if (
    !generic &&
    /\b(founder|co-founder|cofounder|ceo|team|maker)\b/.test(evidence)
  )
    return 500;
  if (
    /partner|partnership/.test(localPart) ||
    /partner|partnership/.test(evidence)
  )
    return 400;
  if (
    /^(hello|hi|contact|info|team)$/.test(localPart) ||
    /contact/.test(evidence)
  )
    return 300;
  if (/^sales$/.test(localPart) || /\bsales\b/.test(evidence)) return 200;
  if (/^support$/.test(localPart) || /\bsupport\b/.test(evidence)) return 100;
  return generic ? 50 : 250;
}

function candidatesFromText(text: string, sourceUrl: string) {
  const normalized = `${text}\n${[...text.matchAll(obfuscatedEmailPattern)]
    .map((match) => normalizeObfuscation(match[0]))
    .join("\n")}`;
  const candidates: EmailCandidate[] = [];
  for (const match of normalized.matchAll(emailPattern)) {
    const email = match[0].toLowerCase().replace(/[.,;:]+$/, "");
    if (isRejected(email)) continue;
    const index = match.index ?? 0;
    const context = normalized
      .slice(
        Math.max(0, index - 120),
        Math.min(normalized.length, index + email.length + 120),
      )
      .replace(/\s+/g, " ")
      .trim();
    candidates.push({
      email,
      sourceUrl,
      context,
      score: scoreCandidate(email, sourceUrl, context),
    });
  }
  return candidates;
}

export function extractEmailCandidates({
  html,
  markdown,
  sourceUrl,
}: {
  html?: string;
  markdown?: string;
  sourceUrl: string;
}) {
  const candidates = candidatesFromText(markdown ?? "", sourceUrl);
  if (html) {
    const $ = cheerio.load(html);
    $("a[href^='mailto:']").each((_index, element) => {
      const href = $(element).attr("href") ?? "";
      candidates.push(
        ...candidatesFromText(
          decodeURIComponent(href.replace(/^mailto:/i, "").split("?")[0]),
          sourceUrl,
        ),
      );
    });
    $("script[type='application/ld+json'], meta[content]").each(
      (_index, element) => {
        const value = $(element).is("meta")
          ? ($(element).attr("content") ?? "")
          : $(element).text();
        candidates.push(...candidatesFromText(value, sourceUrl));
      },
    );
    candidates.push(...candidatesFromText($.root().text(), sourceUrl));
  }

  const bestByEmail = new Map<string, EmailCandidate>();
  for (const candidate of candidates) {
    const existing = bestByEmail.get(candidate.email);
    if (!existing || candidate.score > existing.score)
      bestByEmail.set(candidate.email, candidate);
  }
  return [...bestByEmail.values()].sort(
    (left, right) =>
      right.score - left.score || left.email.localeCompare(right.email),
  );
}

export function discoverUsefulLinks(
  html: string,
  baseUrl: string,
  maximum = 4,
) {
  const $ = cheerio.load(html);
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const links: string[] = [];
  $("a[href]").each((_index, element) => {
    if (links.length >= maximum) return;
    const href = $(element).attr("href");
    if (!href) return;
    try {
      const url = new URL(href, base);
      url.hash = "";
      if (!/^https?:$/.test(url.protocol) || url.hostname !== base.hostname)
        return;
      if (!usefulPath.test(`${url.pathname} ${$(element).text()}`)) return;
      const normalized = url.toString().replace(/\/$/, "");
      if (seen.has(normalized) || normalized === baseUrl.replace(/\/$/, ""))
        return;
      seen.add(normalized);
      links.push(normalized);
    } catch {
      return;
    }
  });
  return links;
}

export function isAllowedContactEmail(email: string) {
  return exactEmailPattern.test(email) && !isRejected(email);
}
