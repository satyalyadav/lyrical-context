import "server-only";

import { LyricalContextError } from "@/lib/errors";

const DEFAULT_JSON_BODY_LIMIT_BYTES = 8 * 1024;
const MAX_ID_LENGTH = 18;
const MAX_SEARCH_QUERY_LENGTH = 100;
const MAX_FALLBACK_TEXT_LENGTH = 200;
const MAX_FALLBACK_URL_LENGTH = 500;
const JSON_CONTENT_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/problem+json",
]);

export function validateSearchQuery(query: string) {
  const normalizedQuery = query.trim();

  if (normalizedQuery.length > MAX_SEARCH_QUERY_LENGTH) {
    throw new LyricalContextError(
      "query_too_long",
      `Search query must be ${MAX_SEARCH_QUERY_LENGTH} characters or fewer.`,
      400
    );
  }

  return normalizedQuery;
}

export function validateNumericId(value: string, label: string) {
  const normalizedValue = value.trim();

  if (
    !normalizedValue ||
    normalizedValue.length > MAX_ID_LENGTH ||
    !/^\d+$/u.test(normalizedValue)
  ) {
    throw new LyricalContextError(
      "invalid_id",
      `${label} must be a numeric identifier.`,
      400
    );
  }

  return normalizedValue;
}

export function validateOptionalText(value: string | null, label: string) {
  if (value === null) {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length > MAX_FALLBACK_TEXT_LENGTH) {
    throw new LyricalContextError(
      "invalid_metadata",
      `${label} must be ${MAX_FALLBACK_TEXT_LENGTH} characters or fewer.`,
      400
    );
  }

  return normalizedValue || null;
}

export function validateOptionalHttpUrl(value: string | null, label: string) {
  if (value === null) {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.length > MAX_FALLBACK_URL_LENGTH) {
    throw new LyricalContextError(
      "invalid_url",
      `${label} must be ${MAX_FALLBACK_URL_LENGTH} characters or fewer.`,
      400
    );
  }

  try {
    const url = new URL(normalizedValue);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("Unsupported protocol");
    }

    return url.toString();
  } catch {
    throw new LyricalContextError(
      "invalid_url",
      `${label} must be a valid HTTP URL.`,
      400
    );
  }
}

export function validateSameOriginUrl(
  value: string | null | undefined,
  request: Request,
  label: string
) {
  const normalizedValue = value?.trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.length > MAX_FALLBACK_URL_LENGTH) {
    throw new LyricalContextError(
      "invalid_url",
      `${label} must be ${MAX_FALLBACK_URL_LENGTH} characters or fewer.`,
      400
    );
  }

  try {
    const url = new URL(normalizedValue);
    const requestUrl = new URL(request.url);

    if (url.origin !== requestUrl.origin) {
      throw new Error("Cross-origin URL");
    }

    return url.toString();
  } catch {
    throw new LyricalContextError(
      "invalid_url",
      `${label} must be a same-origin URL.`,
      400
    );
  }
}

export async function readJsonBody<T>(
  request: Request,
  maxBytes = DEFAULT_JSON_BODY_LIMIT_BYTES
) {
  assertJsonContentType(request);
  const contentLength = request.headers.get("content-length");

  if (contentLength && Number(contentLength) > maxBytes) {
    throw new LyricalContextError(
      "request_too_large",
      "Request body is too large.",
      413
    );
  }

  const text = await readRequestText(request, maxBytes);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LyricalContextError(
      "invalid_json",
      "Request body must be valid JSON.",
      400
    );
  }
}

function assertJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim();

  if (!contentType || !JSON_CONTENT_TYPES.has(contentType.toLocaleLowerCase())) {
    throw new LyricalContextError(
      "unsupported_media_type",
      "Request body must be JSON.",
      415
    );
  }
}

async function readRequestText(request: Request, maxBytes: number) {
  if (!request.body) {
    return "";
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    if (value) {
      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        throw new LyricalContextError(
          "request_too_large",
          "Request body is too large.",
          413
        );
      }

      chunks.push(value);
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}
