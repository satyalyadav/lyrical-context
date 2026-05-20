import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { assertApiAccess, resetApiGuardForTests } from "@/lib/api-guard";
import {
  API_SESSION_COOKIE,
  createApiSessionToken,
} from "@/lib/api-session";
describe("assertApiAccess", () => {
  beforeEach(() => {
    resetApiGuardForTests();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
    delete process.env.GENIUS_ACCESS_TOKEN;
  });

  afterEach(() => {
    resetApiGuardForTests();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
    delete process.env.GENIUS_ACCESS_TOKEN;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("allows requests when no API key is configured", async () => {
    await expect(
      assertApiAccess(
        new Request("http://localhost/api/search", {
          headers: { "x-forwarded-for": "203.0.113.1" },
        })
      )
    ).resolves.toBeUndefined();
  });

  it("allows app requests when an API key is configured but missing", async () => {
    process.env.LYRICAL_CONTEXT_API_KEY = "secret";

    await expect(
      assertApiAccess(new Request("http://localhost/api/search"))
    ).resolves.toBeUndefined();
  });

  it("rejects incorrect bearer tokens when an API key is configured", async () => {
    process.env.LYRICAL_CONTEXT_API_KEY = "secret";

    await expect(
      assertApiAccess(
        new Request("http://localhost/api/search", {
          headers: { authorization: "Bearer wrong" },
        })
      )
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "unauthorized",
        status: 401,
      })
    );
  });

  it("accepts bearer tokens when an API key is configured", async () => {
    process.env.LYRICAL_CONTEXT_API_KEY = "secret";

    await expect(
      assertApiAccess(
        new Request("http://localhost/api/search", {
          headers: { authorization: "Bearer secret" },
        })
      )
    ).resolves.toBeUndefined();
  });

  it("rejects deployed API requests without an app session", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");
    process.env.GENIUS_ACCESS_TOKEN = "token-secret";

    await expect(
      assertApiAccess(
        new Request("https://app.test/api/search", {
          headers: {
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
          },
        })
      )
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "forbidden",
        status: 403,
      })
    );
  });

  it("rejects deployed API requests with direct navigation metadata", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");
    process.env.GENIUS_ACCESS_TOKEN = "token-secret";
    const session = await createApiSessionToken();

    await expect(
      assertApiAccess(
        new Request("https://app.test/api/search", {
          headers: {
            cookie: `${API_SESSION_COOKIE}=${session}`,
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
          },
        })
      )
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "forbidden",
        status: 403,
      })
    );
  });

  it("allows deployed same-origin fetches with an app session", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");
    process.env.GENIUS_ACCESS_TOKEN = "token-secret";
    const session = await createApiSessionToken();

    await expect(
      assertApiAccess(
        new Request("https://app.test/api/search", {
          headers: {
            cookie: `${API_SESSION_COOKIE}=${session}`,
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "x-forwarded-for": "203.0.113.1",
          },
        })
      )
    ).resolves.toBeUndefined();
  });

  it("rate limits repeated requests from the same client", async () => {
    const request = new Request("http://localhost/api/search", {
      headers: { "x-forwarded-for": "203.0.113.9" },
    });

    for (let index = 0; index < 60; index += 1) {
      await assertApiAccess(request);
    }

    await expect(assertApiAccess(request)).rejects.toThrowError(
      expect.objectContaining({
        code: "rate_limited",
        status: 429,
      })
    );
  });
});
