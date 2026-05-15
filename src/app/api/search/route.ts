import { toPublicError, LyricalContextError } from "@/lib/errors";
import { search } from "@/lib/references-service";
import type { SearchType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const query = url.searchParams.get("q") ?? "";

    if (type !== "song" && type !== "album") {
      throw new LyricalContextError(
        "invalid_search_type",
        "Search type must be song or album.",
        400
      );
    }

    const results = await search(type as SearchType, query);

    return Response.json({ results });
  } catch (error) {
    const publicError = toPublicError(error);
    return Response.json(publicError.body, { status: publicError.status });
  }
}
