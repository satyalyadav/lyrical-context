import { toPublicError } from "@/lib/errors";
import { getAlbumReferenceResponse } from "@/lib/references-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AlbumReferenceContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: AlbumReferenceContext) {
  try {
    const { id } = await context.params;
    const payload = await getAlbumReferenceResponse(id);

    return Response.json(payload);
  } catch (error) {
    const publicError = toPublicError(error);
    return Response.json(publicError.body, { status: publicError.status });
  }
}
