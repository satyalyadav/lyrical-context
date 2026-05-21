import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiGuardForTests } from "@/lib/api-guard";
import { search } from "@/lib/references-service";
import { GET } from "./route";

vi.mock("@/lib/references-service", () => ({
  search: vi.fn(),
}));

describe("GET /api/search", () => {
  beforeEach(() => {
    resetApiGuardForTests();
    vi.clearAllMocks();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
  });

  afterEach(() => {
    resetApiGuardForTests();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
  });
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
    expect(response.headers.get("RateLimit-Limit")).toBe("60");
  });

  it("rejects overly long search queries", async () => {
    const response = await GET(
      new Request(`http://app.test/api/search?type=song&q=${"a".repeat(101)}`)
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("query_too_long");
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects incorrect bearer tokens when an API key is configured", async () => {
    process.env.LYRICAL_CONTEXT_API_KEY = "secret";

    const response = await GET(
      new Request("http://app.test/api/search?type=song&q=drake", {
        headers: { authorization: "Bearer wrong" },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("unauthorized");
    expect(search).not.toHaveBeenCalled();
  });
});
