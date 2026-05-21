import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertApiAccess,
  getRateLimitHeaders,
  resetApiGuardForTests,
} from "@/lib/api-guard";
import {
  API_SESSION_COOKIE,
  createApiSessionToken,
} from "@/lib/api-session";

const SESSION_SECRET = "0123456789abcdef0123456789abcdef";

describe("assertApiAccess", () => {
  beforeEach(() => {
    resetApiGuardForTests();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
    delete process.env.LYRICAL_CONTEXT_REQUIRE_API_SESSION;
    delete process.env.LYRICAL_CONTEXT_SESSION_SECRET;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VERCEL", "");
  });

  afterEach(() => {
    resetApiGuardForTests();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("allows local development requests without a session", async () => {
    await expect(
      assertApiAccess(
        new Request("http://localhost/api/search", {
          headers: { "x-forwarded-for": "203.0.113.1" },
        })
      )
    ).resolves.toEqual(
      expect.objectContaining({
        actor: "local",
        rateLimit: expect.objectContaining({ limit: 60 }),
      })
    );
  });

  it("rejects direct session-required requests without an app session", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");
    process.env.LYRICAL_CONTEXT_SESSION_SECRET = SESSION_SECRET;

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

  it("allows session-required same-origin fetches with an app session", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");
    process.env.LYRICAL_CONTEXT_SESSION_SECRET = SESSION_SECRET;
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
    ).resolves.toEqual(
      expect.objectContaining({
        actor: "ui",
        rateLimit: expect.objectContaining({ limit: 60 }),
      })
    );
  });

  it("rejects cross-site fetch metadata even with a valid app session", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");
    process.env.LYRICAL_CONTEXT_SESSION_SECRET = SESSION_SECRET;
    const session = await createApiSessionToken();

    await expect(
      assertApiAccess(
        new Request("https://app.test/api/search", {
          headers: {
            cookie: `${API_SESSION_COOKIE}=${session}`,
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "cross-site",
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

  it("rejects expired app sessions", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");
    process.env.LYRICAL_CONTEXT_SESSION_SECRET = SESSION_SECRET;
    const session = await createApiSessionToken(Date.now() - 3 * 60 * 60 * 1000);

    await expect(
      assertApiAccess(
        new Request("https://app.test/api/search", {
          headers: {
            cookie: `${API_SESSION_COOKIE}=${session}`,
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

  it("rejects explicit session-required mode without a dedicated session secret", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");

    await expect(
      assertApiAccess(new Request("https://app.test/api/search"))
    ).rejects.toThrowError(
      expect.objectContaining({
        code: "security_config_unavailable",
        status: 503,
      })
    );
  });

  it("rejects incorrect API keys", async () => {
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

  it("allows valid API keys without an app session", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");
    process.env.LYRICAL_CONTEXT_API_KEY = "secret";

    await expect(
      assertApiAccess(
        new Request("https://app.test/api/search", {
          headers: { authorization: "Bearer secret" },
        })
      )
    ).resolves.toEqual(
      expect.objectContaining({
        actor: "api-key",
        rateLimit: expect.objectContaining({ limit: 60 }),
      })
    );
  });

  it("rate limits repeated local requests from the same client", async () => {
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

  it("uses separate Redis-backed rate limit policies by route", async () => {
    process.env.KV_REST_API_URL = "https://redis.test";
    process.env.KV_REST_API_TOKEN = "redis-token";
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify([{ result: 1 }, { result: "OK" }]), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const searchAccess = await assertApiAccess(
      new Request("http://localhost/api/search", {
        headers: { "x-vercel-forwarded-for": "198.51.100.1" },
      })
    );
    const albumAccess = await assertApiAccess(
      new Request("http://localhost/api/albums/123/references", {
        headers: { "x-vercel-forwarded-for": "198.51.100.1" },
      })
    );

    expect(searchAccess.rateLimit.limit).toBe(60);
    expect(albumAccess.rateLimit.limit).toBe(10);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://redis.test/pipeline",
      expect.objectContaining({
        body: expect.stringContaining("search"),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://redis.test/pipeline",
      expect.objectContaining({
        body: expect.stringContaining("album-references"),
      })
    );
  });

  it("formats rate limit headers", () => {
    const headers = getRateLimitHeaders({
      limit: 10,
      remaining: 9,
      resetAt: Date.now() + 30_000,
    });

    expect(headers.get("RateLimit-Limit")).toBe("10");
    expect(headers.get("RateLimit-Remaining")).toBe("9");
    expect(headers.get("RateLimit-Reset")).toBeTruthy();
  });
});
