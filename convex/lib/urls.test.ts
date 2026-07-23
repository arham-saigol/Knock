import { describe, expect, it } from "vitest";

import { normalizeWebsiteUrl, rootDomain, validateSenderDomain } from "./urls";

describe("URL normalization", () => {
  it("removes tracking parameters and fragments", () => {
    expect(
      normalizeWebsiteUrl(
        "https://www.example.com/?utm_source=ph&ref=launch#top",
      ),
    ).toBe("https://www.example.com");
  });

  it("validates sender aliases against registrable root domains", () => {
    expect(
      validateSenderDomain("arham@mail.example.co.uk", "app.example.co.uk"),
    ).toBe("arham@mail.example.co.uk");
    expect(() =>
      validateSenderDomain("arham@other.co.uk", "example.co.uk"),
    ).toThrow("root domain");
    expect(rootDomain("https://app.example.co.uk")).toBe("example.co.uk");
  });

  it("keeps private-suffix tenants isolated", () => {
    expect(rootDomain("https://alpha.github.io")).toBe("alpha.github.io");
    expect(rootDomain("https://beta.github.io")).not.toBe(
      rootDomain("https://alpha.github.io"),
    );
  });

  it("rejects malformed sender local parts", () => {
    expect(() =>
      validateSenderDomain("bad..alias@example.com", "example.com"),
    ).toThrow("valid sender email");
    expect(() =>
      validateSenderDomain("bad\nheader@example.com", "example.com"),
    ).toThrow("valid sender email");
  });
});
