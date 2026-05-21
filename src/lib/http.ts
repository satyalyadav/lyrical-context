import "server-only";

import { LyricalContextError } from "@/lib/errors";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1024 * 1024;

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new LyricalContextError(
        "upstream_timeout",
        "Upstream service timed out. Please try again later.",
        504
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readJsonResponse<T>(
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES
) {
  const text = await readResponseText(response, maxBytes);

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new LyricalContextError(
      "upstream_invalid_json",
      "Upstream service returned invalid JSON.",
      502
    );
  }
}

export async function readResponseText(
  response: Response,
  maxBytes = DEFAULT_MAX_RESPONSE_BYTES
) {
  const contentLength = response.headers.get("content-length");

  if (contentLength && Number(contentLength) > maxBytes) {
    throw new LyricalContextError(
      "upstream_response_too_large",
      "Upstream service returned too much data.",
      502
    );
  }

  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
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
          "upstream_response_too_large",
          "Upstream service returned too much data.",
          502
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
