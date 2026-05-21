import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiGuardForTests } from "@/lib/api-guard";
import { getSongReferenceResponse } from "@/lib/references-service";
import { GET } from "./route";

vi.mock("@/lib/references-service", () => ({
  getSongReferenceResponse: vi.fn(),
}));

describe("GET /api/songs/[id]/references", () => {
  beforeEach(() => {
    resetApiGuardForTests();
    vi.clearAllMocks();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
  });

  afterEach(() => {
    resetApiGuardForTests();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
  });
  it("passes dynamic id and fallback metadata to the service", async () => {
    vi.mocked(getSongReferenceResponse).mockResolvedValueOnce({
      song: {
        type: "song",
        id: "3315890",
        title: "God's Plan",
        artist: "Drake",
        artworkUrl: null,
        sourceUrl: "https://genius.com/song",
        metadata: { geniusId: 3315890 },
      },
      references: [],
      source: "live",
    });

    const response = await GET(
      new Request(
        "http://app.test/api/songs/3315890/references?title=God%27s%20Plan&artist=Drake"
      ),
      { params: Promise.resolve({ id: "3315890" }) }
    );

    expect(response.status).toBe(200);
    expect(getSongReferenceResponse).toHaveBeenCalledWith("3315890", {
      title: "God's Plan",
      artist: "Drake",
      artworkUrl: null,
      sourceUrl: null,
    });
    expect(response.headers.get("RateLimit-Limit")).toBe("30");
  });

  it("rejects nonnumeric song ids", async () => {
    const response = await GET(
      new Request("http://app.test/api/songs/not-a-number/references"),
      { params: Promise.resolve({ id: "not-a-number" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_id");
    expect(getSongReferenceResponse).not.toHaveBeenCalled();
  });

  it("rejects invalid fallback URLs", async () => {
    const response = await GET(
      new Request(
        "http://app.test/api/songs/3315890/references?sourceUrl=javascript%3Aalert(1)"
      ),
      { params: Promise.resolve({ id: "3315890" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_url");
    expect(getSongReferenceResponse).not.toHaveBeenCalled();
  });
});
