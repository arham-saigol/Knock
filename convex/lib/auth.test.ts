import { afterEach, describe, expect, it, vi } from "vitest";

import { isIdentityOwner } from "./auth";

function identity(issuer: string) {
  return {
    issuer,
    subject: "user_123",
    tokenIdentifier: `${issuer}|user_123`,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isIdentityOwner", () => {
  it("uses the issuer-qualified token identifier when present", () => {
    const document = {
      ownerId: "user_123",
      ownerTokenIdentifier: "https://issuer-a.example|user_123",
    };

    expect(
      isIdentityOwner(document, identity("https://issuer-a.example")),
    ).toBe(true);
    expect(
      isIdentityOwner(document, identity("https://issuer-b.example")),
    ).toBe(false);
  });

  it("limits legacy subject ownership to the configured migration issuer", () => {
    vi.stubEnv("CLERK_JWT_ISSUER_DOMAIN", "https://issuer-a.example");
    const legacyDocument = { ownerId: "user_123" };

    expect(
      isIdentityOwner(legacyDocument, identity("https://issuer-a.example")),
    ).toBe(true);
    expect(
      isIdentityOwner(legacyDocument, identity("https://issuer-b.example")),
    ).toBe(false);
  });
});
