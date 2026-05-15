import { toPublicError } from "@/lib/errors";
import { getSongReferenceResponse } from "@/lib/references-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SongReferenceContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, context: SongReferenceContext) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const payload = await getSongReferenceResponse(id, {
      title: url.searchParams.get("title"),
      artist: url.searchParams.get("artist"),
      artworkUrl: url.searchParams.get("artworkUrl"),
      sourceUrl: url.searchParams.get("sourceUrl"),
    });

    return Response.json(payload);
  } catch (error) {
    const publicError = toPublicError(error);
    return Response.json(publicError.body, { status: publicError.status });
  }
}
