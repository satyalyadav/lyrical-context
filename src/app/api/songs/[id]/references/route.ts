import {
  assertApiAccess,
  getRateLimitHeaders,
  type ApiAccessContext,
} from "@/lib/api-guard";
import { jsonWithBudgetHeaders } from "@/lib/api-response";
import { toPublicError } from "@/lib/errors";
import {
  validateNumericId,
  validateOptionalHttpUrl,
  validateOptionalText,
} from "@/lib/request-validation";
import { getSongReferenceResponse } from "@/lib/references-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SongReferenceContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: SongReferenceContext) {
  let access: ApiAccessContext | null = null;

  try {
    access = await assertApiAccess(request);

    const { id } = await context.params;
    const url = new URL(request.url);
    const payload = await getSongReferenceResponse(validateNumericId(id, "Song ID"), {
      title: validateOptionalText(url.searchParams.get("title"), "Song title"),
      artist: validateOptionalText(url.searchParams.get("artist"), "Artist"),
      artworkUrl: validateOptionalHttpUrl(url.searchParams.get("artworkUrl"), "Artwork URL"),
      sourceUrl: validateOptionalHttpUrl(url.searchParams.get("sourceUrl"), "Source URL"),
    });

    return jsonWithBudgetHeaders(payload, {
      headers: getRateLimitHeaders(access.rateLimit),
    });
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
