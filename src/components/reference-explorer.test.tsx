import { render, screen, within } from "@testing-library/react";
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
      screen.getByPlaceholderText("e.g. God's Plan"),
      "drake gods plan"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    const resultButton = await screen.findByRole("button", {
      name: /God's Plan/i,
    });
    expect(within(resultButton).queryByText("song")).not.toBeInTheDocument();
    await userEvent.click(resultButton);

    expect(await screen.findByText("I finessed down Weston Road")).toBeVisible();
    expect(screen.getByText("A reference to a Toronto street.")).toBeVisible();
    expect(screen.queryByText("Source: Genius")).not.toBeInTheDocument();
  });

  it("surfaces setup errors from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
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
      screen.getByPlaceholderText("e.g. God's Plan"),
      "drake"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(
      await screen.findByText("Set GENIUS_ACCESS_TOKEN in .env.local.")
    ).toBeVisible();
  });

  it("searches automatically while typing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
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
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReferenceExplorer />);

    await userEvent.type(screen.getByPlaceholderText("e.g. God's Plan"), "god");

    const resultButton = await screen.findByRole("button", {
      name: /God's Plan/i,
    });
    expect(resultButton).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/search?type=song&q=god",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("keeps song and album search state separate", async () => {
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
          results: [
            {
              type: "album",
              id: "1406109769",
              title: "Scorpion",
              artist: "Drake",
              artworkUrl: null,
              sourceUrl: "https://music.apple.com/album",
              metadata: {
                collectionId: 1406109769,
                trackCount: 25,
                releaseYear: "2018",
              },
            },
          ],
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReferenceExplorer />);

    await userEvent.type(
      screen.getByPlaceholderText("e.g. God's Plan"),
      "God's Plan"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(
      await screen.findByRole("button", { name: /God's Plan/i })
    ).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Album" }));

    expect(screen.getByPlaceholderText("e.g. Scorpion")).toHaveValue("");
    expect(
      screen.queryByRole("button", { name: /God's Plan/i })
    ).not.toBeInTheDocument();
    expect(screen.getByText("No search yet")).toBeVisible();

    await userEvent.type(screen.getByPlaceholderText("e.g. Scorpion"), "Scorpion");
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(
      await screen.findByRole("button", { name: /Scorpion/i })
    ).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Song" }));

    expect(screen.getByPlaceholderText("e.g. God's Plan")).toHaveValue(
      "God's Plan"
    );
    expect(screen.getByRole("button", { name: /God's Plan/i })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Scorpion/i })
    ).not.toBeInTheDocument();
  });

  it("shows a skeleton workspace while references load", async () => {
    let resolveReferences:
      | ((response: Response | PromiseLike<Response>) => void)
      | undefined;
    const pendingReferences = new Promise<Response>((resolve) => {
      resolveReferences = resolve;
    });
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
      .mockReturnValueOnce(pendingReferences);
    vi.stubGlobal("fetch", fetchMock);

    render(<ReferenceExplorer />);

    await userEvent.type(
      screen.getByPlaceholderText("e.g. God's Plan"),
      "drake gods plan"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("God's Plan");

    await userEvent.click(screen.getByRole("button", { name: /God's Plan/i }));

    expect(await screen.findByText("Loading Genius references")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Source/i })).toBeVisible();
    expect(screen.getByText("Accepted")).toBeVisible();
    expect(screen.getByText("Unverified")).toBeVisible();
    expect(screen.queryByText("Loading")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();

    resolveReferences?.(
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
        references: [],
        source: "live",
      })
    );
    expect(await screen.findByText("No references yet")).toBeVisible();
  });

  it("renders duplicate Genius annotation ids without duplicate key warnings", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
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
              id: "8225487",
              referentId: "referent-1",
              fragment: "First duplicated fragment",
              annotation: "First note.",
              annotationHtml: null,
              sourceUrl: "https://genius.com/annotation/1",
              state: "accepted",
              classification: "accepted",
              verified: false,
              votesTotal: 3,
              categories: ["verified-accepted"],
            },
            {
              id: "8225487",
              referentId: "referent-2",
              fragment: "Second duplicated fragment",
              annotation: "Second note.",
              annotationHtml: null,
              sourceUrl: "https://genius.com/annotation/2",
              state: "accepted",
              classification: "accepted",
              verified: false,
              votesTotal: 5,
              categories: ["verified-accepted"],
            },
          ],
          source: "live",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    try {
      render(<ReferenceExplorer />);

      await userEvent.type(
        screen.getByPlaceholderText("e.g. God's Plan"),
        "drake gods plan"
      );
      await userEvent.click(screen.getByRole("button", { name: "Search" }));
      await screen.findByText("God's Plan");
      await userEvent.click(screen.getByRole("button", { name: /God's Plan/i }));

      expect(await screen.findByText("First duplicated fragment")).toBeVisible();
      expect(screen.getByText("Second duplicated fragment")).toBeVisible();
      expect(
        consoleErrorSpy.mock.calls.some(([message]) =>
          String(message).includes("same key")
        )
      ).toBe(false);
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("switches to album search", async () => {
    render(<ReferenceExplorer />);

    await userEvent.click(screen.getByRole("button", { name: "Album" }));

    expect(screen.getByPlaceholderText("e.g. Scorpion")).toBeVisible();
  });

  it("keeps album track references collapsed until a track is opened", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              type: "album",
              id: "1406109769",
              title: "Scorpion",
              artist: "Drake",
              artworkUrl: null,
              sourceUrl: "https://music.apple.com/album",
              metadata: {
                collectionId: 1406109769,
                trackCount: 2,
                releaseYear: "2018",
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          album: {
            type: "album",
            id: "1406109769",
            title: "Scorpion",
            artist: "Drake",
            artworkUrl: null,
            sourceUrl: "https://music.apple.com/album",
            metadata: {
              collectionId: 1406109769,
              trackCount: 2,
              releaseYear: "2018",
            },
          },
          tracks: [
            {
              track: {
                id: "1",
                title: "First Track",
                artist: "Drake",
                trackNumber: 1,
                discNumber: 1,
                explicitness: "explicit",
              },
              matchStatus: "matched",
              matchConfidence: 1,
              matchedSong: null,
              references: [
                {
                  id: "ref-1",
                  referentId: "referent-1",
                  fragment: "A hidden line",
                  annotation: "A hidden reference.",
                  annotationHtml: null,
                  sourceUrl: "https://genius.com/annotation",
                  state: "accepted",
                  classification: "accepted",
                  verified: false,
                  votesTotal: 4,
                  categories: ["verified-accepted"],
                },
              ],
              error: null,
            },
            {
              track: {
                id: "2",
                title: "Second Track",
                artist: "Drake",
                trackNumber: 2,
                discNumber: 1,
                explicitness: "explicit",
              },
              matchStatus: "matched",
              matchConfidence: 0.92,
              matchedSong: null,
              references: [
                {
                  id: "ref-2",
                  referentId: "referent-2",
                  fragment: "Another hidden line",
                  annotation: "Another hidden reference.",
                  annotationHtml: null,
                  sourceUrl: "https://genius.com/annotation",
                  state: "accepted",
                  classification: "accepted",
                  verified: false,
                  votesTotal: 6,
                  categories: ["verified-accepted"],
                },
              ],
              error: null,
            },
          ],
          source: "live",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReferenceExplorer />);

    await userEvent.click(screen.getByRole("button", { name: "Album" }));
    await userEvent.type(
      screen.getByPlaceholderText("e.g. Scorpion"),
      "scorpion"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("Scorpion");
    await userEvent.click(screen.getByRole("button", { name: /Scorpion/i }));

    await screen.findByRole("button", { name: /First Track/i });
    expect(screen.queryByText("A hidden line")).not.toBeInTheDocument();
    expect(screen.queryByText("Another hidden line")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /First Track/i }));

    expect(await screen.findByText("A hidden line")).toBeVisible();
    expect(screen.queryByText("Another hidden line")).not.toBeInTheDocument();
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
