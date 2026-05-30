import {
  assertApiAccess,
  getRateLimitHeaders,
  type ApiAccessContext,
} from "@/lib/api-guard";
import { jsonWithBudgetHeaders } from "@/lib/api-response";
import { toPublicError } from "@/lib/errors";
import { validateAlbumId } from "@/lib/request-validation";
import { getAlbumReferenceResponse } from "@/lib/references-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AlbumReferenceContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: AlbumReferenceContext) {
  let access: ApiAccessContext | null = null;

  try {
    access = await assertApiAccess(request);

    const { id } = await context.params;
    const payload = await getAlbumReferenceResponse(validateAlbumId(id));

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
