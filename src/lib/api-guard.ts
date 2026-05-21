import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  API_SESSION_COOKIE,
  getApiSessionConfigError,
  verifyApiSessionToken,
} from "@/lib/api-session";
import { LyricalContextError } from "@/lib/errors";
import { getRedisConfig, runRedisPipeline } from "@/lib/redis";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

type RateLimitPolicy = {
  key: string;
  limit: number;
  windowSeconds: number;
};

export type RateLimitSnapshot = {
  limit: number;
  remaining: number;
  resetAt: number;
};

export type ApiAccessContext = {
  actor: "api-key" | "local" | "ui";
  rateLimit: RateLimitSnapshot;
};

const RATE_LIMIT_POLICIES: Array<{
  pattern: RegExp;
  policy: RateLimitPolicy;
}> = [
  {
    pattern: /^\/api\/albums\/[^/]+\/references$/u,
    policy: { key: "album-references", limit: 10, windowSeconds: 10 * 60 },
  },
  {
    pattern: /^\/api\/songs\/[^/]+\/references$/u,
    policy: { key: "song-references", limit: 30, windowSeconds: 60 },
  },
  {
    pattern: /^\/api\/report$/u,
    policy: { key: "report", limit: 5, windowSeconds: 60 * 60 },
  },
  {
    pattern: /^\/api\/search$/u,
    policy: { key: "search", limit: 60, windowSeconds: 60 },
  },
];
const DEFAULT_RATE_LIMIT_POLICY = {
  key: "api",
  limit: 60,
  windowSeconds: 60,
} satisfies RateLimitPolicy;
const localRateLimitBuckets = new Map<string, RateLimitBucket>();

export async function assertApiAccess(
  request: Request
): Promise<ApiAccessContext> {
  const actor = await assertActorAccess(request);
  const rateLimit = await assertRateLimit(request);

  return { actor, rateLimit };
}

export function getRateLimitHeaders(snapshot: RateLimitSnapshot) {
  const headers = new Headers();
  const resetSeconds = Math.max(1, Math.ceil((snapshot.resetAt - Date.now()) / 1000));

  headers.set("RateLimit-Limit", String(snapshot.limit));
  headers.set("RateLimit-Remaining", String(snapshot.remaining));
  headers.set("RateLimit-Reset", String(resetSeconds));

  return headers;
}

async function assertActorAccess(request: Request): Promise<ApiAccessContext["actor"]> {
  const configuredKey = process.env.LYRICAL_CONTEXT_API_KEY?.trim();
  const providedKey = getProvidedApiKey(request);

  if (providedKey) {
    if (configuredKey && safeEqual(providedKey, configuredKey)) {
      return "api-key";
    }

    throw new LyricalContextError(
      "unauthorized",
      "A valid API key is required for this endpoint.",
      401
    );
  }

  if (!requiresApiSession()) {
    return "local";
  }

  const configError = getApiSessionConfigError();

  if (configError) {
    throw new LyricalContextError(
      "security_config_unavailable",
      "API session security is not configured.",
      503
    );
  }

  if (!(await verifyApiSessionToken(getCookieValue(request, API_SESSION_COOKIE)))) {
    throw new LyricalContextError(
      "forbidden",
      "Load the app before using this endpoint.",
      403
    );
  }

  assertSameOriginBrowserFetch(request);
  return "ui";
}

function assertSameOriginBrowserFetch(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  const mode = request.headers.get("sec-fetch-mode");
  const destination = request.headers.get("sec-fetch-dest");

  if (site !== "same-origin" || !mode || !["cors", "same-origin"].includes(mode)) {
    throwDirectApiError();
  }

  if (destination && destination !== "empty") {
    throwDirectApiError();
  }
}

function throwDirectApiError(): never {
  throw new LyricalContextError(
    "forbidden",
    "API routes can only be used by the app.",
    403
  );
}

function requiresApiSession() {
  return process.env.LYRICAL_CONTEXT_REQUIRE_API_SESSION === "true";
}

async function assertRateLimit(request: Request) {
  const policy = getRateLimitPolicy(new URL(request.url).pathname);
  const now = Date.now();
  const windowStartedAt =
    Math.floor(now / (policy.windowSeconds * 1000)) * policy.windowSeconds * 1000;
  const resetAt = windowStartedAt + policy.windowSeconds * 1000;
  const key = [
    "lyrical-context:rate",
    policy.key,
    getClientKey(request),
    windowStartedAt,
  ].join(":");
  const count = await incrementRateLimitCounter(key, policy.windowSeconds, resetAt);
  const snapshot = {
    limit: policy.limit,
    remaining: Math.max(0, policy.limit - count),
    resetAt,
  } satisfies RateLimitSnapshot;

  if (count > policy.limit) {
    const headers = getRateLimitHeaders(snapshot);
    headers.set("Retry-After", String(Math.max(1, Math.ceil((resetAt - now) / 1000))));

    throw new LyricalContextError(
      "rate_limited",
      "Too many requests. Please wait and try again.",
      429,
      headers
    );
  }

  return snapshot;
}

async function incrementRateLimitCounter(
  key: string,
  windowSeconds: number,
  resetAt: number
) {
  const redis = getRedisConfig();

  if (redis) {
    const result = await runRedisPipeline(redis, [
      ["INCR", key],
      ["EXPIRE", key, String(windowSeconds)],
    ]);
    return toNumber(result[0], 0);
  }

  const bucket = localRateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= Date.now()) {
    localRateLimitBuckets.set(key, { count: 1, resetAt });
    return 1;
  }

  bucket.count += 1;
  return bucket.count;
}

function getRateLimitPolicy(pathname: string) {
  return (
    RATE_LIMIT_POLICIES.find((item) => item.pattern.test(pathname))?.policy ??
    DEFAULT_RATE_LIMIT_POLICY
  );
}

function getProvidedApiKey(request: Request) {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-api-key")?.trim() ?? null;
}

function getClientKey(request: Request) {
  for (const header of ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"]) {
    const value = request.headers.get(header);

    if (value) {
      return value.split(",")[0]?.trim() || "unknown";
    }
  }

  return "local";
}

function getCookieValue(request: Request, name: string) {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  for (const cookie of cookieHeader.split(";")) {
    const [cookieName, ...valueParts] = cookie.trim().split("=");

    if (cookieName === name) {
      return valueParts.join("=");
    }
  }

  return null;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function toNumber(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  return fallback;
}

export function resetApiGuardForTests() {
  localRateLimitBuckets.clear();
}
