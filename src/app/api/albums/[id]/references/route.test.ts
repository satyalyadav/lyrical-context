import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiGuardForTests } from "@/lib/api-guard";
import { getAlbumReferenceResponse } from "@/lib/references-service";
import { GET } from "./route";

vi.mock("@/lib/references-service", () => ({
  getAlbumReferenceResponse: vi.fn(),
}));

describe("GET /api/albums/[id]/references", () => {
  beforeEach(() => {
    resetApiGuardForTests();
    vi.clearAllMocks();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
  });

  afterEach(() => {
    resetApiGuardForTests();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
  });

  it("passes numeric album ids to the service", async () => {
    vi.mocked(getAlbumReferenceResponse).mockResolvedValueOnce({
      album: {
        type: "album",
        id: "1440824353",
        title: "Album",
        artist: "Artist",
        artworkUrl: null,
        sourceUrl: "https://music.apple.com/album",
        metadata: { collectionId: 1440824353, trackCount: 1, releaseYear: "2024" },
      },
      tracks: [],
      source: "live",
    });

    const response = await GET(
      new Request("http://app.test/api/albums/1440824353/references"),
      { params: Promise.resolve({ id: "1440824353" }) }
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("RateLimit-Limit")).toBe("10");
    expect(getAlbumReferenceResponse).toHaveBeenCalledWith("1440824353");
  });

  it("rejects nonnumeric album ids", async () => {
    const response = await GET(
      new Request("http://app.test/api/albums/not-a-number/references"),
      { params: Promise.resolve({ id: "not-a-number" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_id");
    expect(getAlbumReferenceResponse).not.toHaveBeenCalled();
  });
});
