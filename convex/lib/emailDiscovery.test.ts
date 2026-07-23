import { describe, expect, it } from "vitest";

import {
  extractEmailCandidates,
  isAllowedContactEmail,
} from "./emailDiscovery";

describe("email discovery", () => {
  it("extracts source-backed visible, mailto, metadata, and obfuscated addresses", () => {
    const candidates = extractEmailCandidates({
      sourceUrl: "https://example.com/contact",
      html: `
        <meta name="contact" content="partners@example.com">
        <a href="mailto:founder@example.com">Email the founder</a>
        <p>General: hello [at] example [dot] com</p>
      `,
    });

    expect(candidates.map((candidate) => candidate.email)).toEqual(
      expect.arrayContaining([
        "founder@example.com",
        "partners@example.com",
        "hello@example.com",
      ]),
    );
    expect(candidates[0].sourceUrl).toBe("https://example.com/contact");
  });

  it("rejects legal, privacy, security, and automated mailboxes", () => {
    for (const email of [
      "privacy@example.com",
      "legal@example.com",
      "security@example.com",
      "noreply@example.com",
    ]) {
      expect(isAllowedContactEmail(email)).toBe(false);
    }
    expect(isAllowedContactEmail("hello@example.com")).toBe(true);
  });
});
