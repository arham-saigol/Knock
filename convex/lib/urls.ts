import { getDomain } from "tldts";

export function normalizeDomain(input: string) {
  const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(candidate);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) {
    throw new Error("Enter a public website domain");
  }
  return hostname;
}

export function rootDomain(input: string) {
  const hostname = normalizeDomain(input);
  return getDomain(hostname, { allowPrivateDomains: true }) ?? hostname;
}

export function normalizeWebsiteUrl(input: string | undefined) {
  if (!input) return undefined;
  try {
    const candidate = /^https?:\/\//i.test(input) ? input : `https://${input}`;
    const url = new URL(candidate);
    if (!/^https?:$/.test(url.protocol)) return undefined;
    if (url.hostname === "localhost" || url.hostname.endsWith(".local"))
      return undefined;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|ref_|source$|source_)/i.test(key))
        url.searchParams.delete(key);
    }
    if (url.pathname === "/") url.pathname = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

export function isSameRootDomain(url: string, domain: string) {
  try {
    return rootDomain(new URL(url).hostname) === rootDomain(domain);
  } catch {
    return false;
  }
}

export function validateSenderDomain(
  senderEmail: string,
  projectDomain: string,
) {
  const normalized = senderEmail.trim().toLowerCase();
  const parts = normalized.split("@");
  const localPart = parts[0] ?? "";
  const domain = parts[1] ?? "";
  if (
    parts.length !== 2 ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(localPart) ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    localPart.length > 64 ||
    normalized.length > 254 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("Enter a valid sender email");
  }
  if (rootDomain(domain) !== rootDomain(projectDomain)) {
    throw new Error("Sender email must use the project's root domain");
  }
  return `${localPart}@${domain}`;
}
