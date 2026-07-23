import type { request as httpRequest } from "node:http";
import type { LookupFunction } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const networkMocks = {
  lookup: vi.fn(),
  request: vi.fn(),
};

import { assertPublicHttpUrl, requestPinnedHttpUrl } from "./productHunt";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Product Hunt redirect SSRF protection", () => {
  it.each([
    ["private", "10.1.2.3", 4],
    ["loopback", "127.0.0.1", 4],
    ["link-local", "169.254.1.2", 4],
    ["IPv4-mapped IPv6", "::ffff:10.1.2.3", 6],
  ])("rejects a %s DNS result", async (_label, address, family) => {
    networkMocks.lookup.mockResolvedValue([{ address, family }]);

    await expect(
      assertPublicHttpUrl("https://redirect.example/path", networkMocks.lookup),
    ).rejects.toThrow("non-public address");
  });

  it("rejects a literal blocked address without resolving DNS", async () => {
    await expect(
      assertPublicHttpUrl("http://127.0.0.1/path", networkMocks.lookup),
    ).rejects.toThrow("non-public address");
    expect(networkMocks.lookup).not.toHaveBeenCalled();
  });

  it("accepts and returns public DNS results", async () => {
    const addresses = [{ address: "8.8.8.8", family: 4 }];
    networkMocks.lookup.mockResolvedValue(addresses);

    await expect(
      assertPublicHttpUrl("https://redirect.example/path", networkMocks.lookup),
    ).resolves.toMatchObject({ addresses });
  });

  it("pins the HTTP request lookup to the validated addresses", async () => {
    const addresses = [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ];
    let pinnedLookup: LookupFunction | undefined;
    networkMocks.request.mockImplementation((_url, options, callback) => {
      pinnedLookup = options.lookup;
      callback({
        statusCode: 200,
        headers: {},
        destroy: vi.fn(),
      });
      return { once: vi.fn(), end: vi.fn() };
    });

    await requestPinnedHttpUrl(
      new URL("https://redirect.example/path"),
      addresses,
      networkMocks.request as unknown as typeof httpRequest,
    );

    const lookupAll = pinnedLookup as unknown as (
      hostname: string,
      options: { all: true },
      callback: (
        error: NodeJS.ErrnoException | null,
        result: typeof addresses,
      ) => void,
    ) => void;
    await new Promise<void>((resolve, reject) => {
      lookupAll("redirect.example", { all: true }, (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        expect(result).toEqual(addresses);
        resolve();
      });
    });
  });
});
