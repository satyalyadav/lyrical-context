import "server-only";

import { API_SESSION_COOKIE, verifyApiSessionToken } from "@/lib/api-session";
import { LyricalContextError } from "@/lib/errors";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 60;

const rateLimitBuckets = new Map<string, RateLimitBucket>();

export async function assertApiAccess(request: Request) {
  assertApiKey(request);
  await assertApiSession(request);
  assertSameOriginBrowserFetch(request);
  assertRateLimit(request);
}

function assertApiKey(request: Request) {
  const configuredKey = process.env.LYRICAL_CONTEXT_API_KEY?.trim();
  const providedKey = getProvidedApiKey(request);

  if (!configuredKey || !providedKey) {
    return;
  }

  if (providedKey !== configuredKey) {
    throw new LyricalContextError(
      "unauthorized",
      "A valid API key is required for this endpoint.",
      401
    );
  }
}

async function assertApiSession(request: Request) {
  if (!requiresApiSession()) {
    return;
  }

  if (await verifyApiSessionToken(getCookieValue(request, API_SESSION_COOKIE))) {
    return;
  }

  throw new LyricalContextError(
    "forbidden",
    "Load the app before using this endpoint.",
    403
  );
}

function assertSameOriginBrowserFetch(request: Request) {
  if (!requiresApiSession()) {
    return;
  }

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
  return (
    process.env.LYRICAL_CONTEXT_REQUIRE_API_SESSION === "true" ||
    process.env.VERCEL === "1" ||
    process.env.NODE_ENV === "production"
  );
}

function assertRateLimit(request: Request) {
  const key = getClientKey(request);
  const now = Date.now();
  const bucket = rateLimitBuckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitBuckets.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });
    return;
  }

  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    throw new LyricalContextError(
      "rate_limited",
      "Too many requests. Please wait a minute and try again.",
      429
    );
  }

  bucket.count += 1;
}

function getProvidedApiKey(request: Request) {
  const authorization = request.headers.get("authorization");

  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }

  return request.headers.get("x-api-key")?.trim() ?? null;
}

function getClientKey(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip")?.trim() ?? "local";
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

export function resetApiGuardForTests() {
  rateLimitBuckets.clear();
}
