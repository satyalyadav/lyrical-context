import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ReferenceExplorer } from "@/components/reference-explorer";

describe("ReferenceExplorer", () => {
  it("searches songs and opens references", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              type: "song",
              id: "3315890",
              title: "God's Plan",
              artist: "Drake",
              artworkUrl: null,
              sourceUrl: "https://genius.com/song",
              metadata: { geniusId: 3315890 },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          song: {
            type: "song",
            id: "3315890",
            title: "God's Plan",
            artist: "Drake",
            artworkUrl: null,
            sourceUrl: "https://genius.com/song",
            metadata: { geniusId: 3315890 },
          },
          references: [
            {
              id: "1",
              referentId: "10",
              fragment: "I finessed down Weston Road",
              annotation: "A reference to a Toronto street.",
              annotationHtml: null,
              sourceUrl: "https://genius.com/annotation",
              state: "accepted",
              classification: "accepted",
              verified: false,
              votesTotal: 12,
              categories: ["names-places", "verified-accepted"],
            },
          ],
          source: "live",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReferenceExplorer />);

    await userEvent.type(
      screen.getByPlaceholderText("e.g. Drake God's Plan"),
      "drake gods plan"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("God's Plan");
    await userEvent.click(screen.getByRole("button", { name: /God's Plan/i }));

    expect(await screen.findByText("I finessed down Weston Road")).toBeVisible();
    expect(screen.getByText("A reference to a Toronto street.")).toBeVisible();
  });

  it("surfaces setup errors from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "missing_genius_token",
              message: "Set GENIUS_ACCESS_TOKEN in .env.local.",
            },
          },
          500
        )
      )
    );

    render(<ReferenceExplorer />);
    await userEvent.type(
      screen.getByPlaceholderText("e.g. Drake God's Plan"),
      "drake"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText("Set GENIUS_ACCESS_TOKEN in .env.local.")
    ).toBeVisible();
  });

  it("switches to album search", async () => {
    render(<ReferenceExplorer />);

    await userEvent.click(screen.getByRole("button", { name: "Album" }));

    expect(screen.getByPlaceholderText("e.g. Drake Scorpion")).toBeVisible();
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
