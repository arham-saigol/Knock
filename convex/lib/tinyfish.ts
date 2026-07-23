type TinyFishResult = {
  url: string;
  final_url?: string;
  title?: string;
  description?: string;
  format?: string;
  text?: string;
};

type TinyFishFetchResponse = {
  results?: TinyFishResult[];
  errors?: Array<{ url?: string; error?: string }>;
};

function apiKey() {
  const value = process.env.TINYFISH_API_KEY;
  if (!value) throw new Error("TINYFISH_API_KEY is not configured");
  return value;
}

export async function tinyFishFetch(
  urls: string[],
  format: "html" | "markdown",
  purpose = "Research a launched product and find published business contact details",
) {
  if (urls.length === 0) return [];
  const response = await fetch("https://api.fetch.tinyfish.ai", {
    method: "POST",
    headers: {
      "X-API-Key": apiKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      urls: urls.slice(0, 10),
      format,
      ttl: 3_600,
      purpose,
      exclude_selectors: [
        "nav",
        "[role='dialog']",
        ".cookie-banner",
        "#cookie-banner",
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  const payload = (await response
    .json()
    .catch(() => ({}))) as TinyFishFetchResponse;
  if (!response.ok) {
    throw new Error(
      `TinyFish Fetch ${response.status}: ${response.statusText}`,
    );
  }
  return (payload.results ?? []).filter(
    (result) => typeof result.text === "string",
  );
}

type SearchResult = {
  position?: number;
  site_name?: string;
  title?: string;
  snippet?: string;
  url?: string;
};

export async function tinyFishSearch(query: string) {
  const url = new URL("https://api.search.tinyfish.ai");
  url.searchParams.set("query", query);
  url.searchParams.set(
    "purpose",
    "Find an official published contact email for a launched product",
  );
  const response = await fetch(url, {
    headers: { "X-API-Key": apiKey() },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    results?: SearchResult[];
  };
  if (!response.ok)
    throw new Error(
      `TinyFish Search ${response.status}: ${response.statusText}`,
    );
  return payload.results ?? [];
}
