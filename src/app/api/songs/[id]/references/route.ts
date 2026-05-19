import { assertApiAccess } from "@/lib/api-guard";
import { jsonWithBudgetHeaders } from "@/lib/api-response";
import { toPublicError } from "@/lib/errors";
import { getSongReferenceResponse } from "@/lib/references-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SongReferenceContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: SongReferenceContext) {
  try {
    await assertApiAccess(request);

    const { id } = await context.params;
    const url = new URL(request.url);
    const payload = await getSongReferenceResponse(id, {
      title: url.searchParams.get("title"),
      artist: url.searchParams.get("artist"),
      artworkUrl: url.searchParams.get("artworkUrl"),
      sourceUrl: url.searchParams.get("sourceUrl"),
    });

    return jsonWithBudgetHeaders(payload);
  } catch (error) {
    const publicError = toPublicError(error);
    return jsonWithBudgetHeaders(publicError.body, {
      status: publicError.status,
    });
  }
}
