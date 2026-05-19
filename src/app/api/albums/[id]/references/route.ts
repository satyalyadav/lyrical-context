import { assertApiAccess } from "@/lib/api-guard";
import { jsonWithBudgetHeaders } from "@/lib/api-response";
import { toPublicError } from "@/lib/errors";
import { getAlbumReferenceResponse } from "@/lib/references-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AlbumReferenceContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: AlbumReferenceContext) {
  try {
    await assertApiAccess(request);

    const { id } = await context.params;
    const payload = await getAlbumReferenceResponse(id);

    return jsonWithBudgetHeaders(payload);
  } catch (error) {
    const publicError = toPublicError(error);
    return jsonWithBudgetHeaders(publicError.body, {
      status: publicError.status,
    });
  }
}
