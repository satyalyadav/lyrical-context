import {
  assertApiAccess,
  getRateLimitHeaders,
  type ApiAccessContext,
} from "@/lib/api-guard";
import { jsonWithBudgetHeaders } from "@/lib/api-response";
import { toPublicError, LyricalContextError } from "@/lib/errors";
import { validateSearchQuery } from "@/lib/request-validation";
import { search } from "@/lib/references-service";
import type { SearchType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let access: ApiAccessContext | null = null;

  try {
    access = await assertApiAccess(request);

    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const query = validateSearchQuery(url.searchParams.get("q") ?? "");

    if (type !== "song" && type !== "album") {
      throw new LyricalContextError(
        "invalid_search_type",
        "Search type must be song or album.",
        400
      );
    }

    const results = await search(type as SearchType, query);

    return jsonWithBudgetHeaders(
      { results },
      { headers: getRateLimitHeaders(access.rateLimit) }
    );
  } catch (error) {
    const publicError = toPublicError(error);
    const headers = new Headers(publicError.headers);

    if (access) {
      getRateLimitHeaders(access.rateLimit).forEach((value, key) => {
        headers.set(key, value);
      });
    }

    return jsonWithBudgetHeaders(publicError.body, {
      status: publicError.status,
      headers,
    });
  }
}
