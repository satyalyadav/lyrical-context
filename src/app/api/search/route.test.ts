import { describe, expect, it, vi } from "vitest";

import { search } from "@/lib/references-service";
import { GET } from "./route";

vi.mock("@/lib/references-service", () => ({
  search: vi.fn(),
}));

describe("GET /api/search", () => {
  it("rejects invalid search types", async () => {
    const response = await GET(new Request("http://app.test/api/search?type=bad"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_search_type");
  });

  it("returns normalized search results", async () => {
    vi.mocked(search).mockResolvedValueOnce([
      {
        type: "song",
        id: "1",
        title: "God's Plan",
        artist: "Drake",
        artworkUrl: null,
        sourceUrl: "https://genius.com/song",
        metadata: { geniusId: 1 },
      },
    ]);

    const response = await GET(
      new Request("http://app.test/api/search?type=song&q=drake")
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.results[0].title).toBe("God's Plan");
    expect(search).toHaveBeenCalledWith("song", "drake");
  });
});
