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
              sortIndex: 0,
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

  it("shows music metadata for the selected song", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              type: "song",
              id: "3876994",
              title: "SICKO MODE",
              artist: "Travis Scott",
              artworkUrl: null,
              sourceUrl: "https://genius.com/song",
              metadata: { geniusId: 3876994 },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          song: {
            type: "song",
            id: "3876994",
            title: "SICKO MODE",
            artist: "Travis Scott",
            artworkUrl: null,
            sourceUrl: "https://genius.com/song",
            metadata: {
              geniusId: 3876994,
              releaseYear: "2018",
              albumTitle: "ASTROWORLD",
              featuredArtists: ["Drake"],
            },
          },
          references: [
            {
              id: "1",
              referentId: "10",
              sortIndex: 0,
              fragment: "See the shots that I took",
              annotation: "Annotation.",
              annotationHtml: null,
              sourceUrl: "https://genius.com/annotation",
              state: "accepted",
              classification: "accepted",
              verified: false,
              votesTotal: 12,
              categories: ["verified-accepted"],
            },
          ],
          source: "live",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReferenceExplorer />);

    await userEvent.type(
      screen.getByPlaceholderText("e.g. God's Plan"),
      "sicko mode"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /SICKO MODE/i })
    );

    expect(await screen.findByText("2018")).toBeVisible();
    expect(screen.getByText("1 reference")).toBeVisible();
    expect(screen.getByText("Album: ASTROWORLD")).toBeVisible();
    expect(screen.getByText("Feat. Drake")).toBeVisible();
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
              sortIndex: 0,
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
              sortIndex: 1,
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

  it("renders song references in lyric order", async () => {
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
              id: "late",
              referentId: "referent-late",
              sortIndex: 2000,
              fragment: "Later line",
              annotation: "Later annotation.",
              annotationHtml: null,
              sourceUrl: "https://genius.com/annotation/late",
              state: "accepted",
              classification: "accepted",
              verified: false,
              votesTotal: 3,
              categories: ["verified-accepted"],
            },
            {
              id: "early",
              referentId: "referent-early",
              sortIndex: 0,
              fragment: "Earlier line",
              annotation: "Earlier annotation.",
              annotationHtml: null,
              sourceUrl: "https://genius.com/annotation/early",
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

    render(<ReferenceExplorer />);

    await userEvent.type(
      screen.getByPlaceholderText("e.g. God's Plan"),
      "drake gods plan"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await screen.findByText("God's Plan");
    await userEvent.click(screen.getByRole("button", { name: /God's Plan/i }));

    expect(await screen.findByText("Earlier line")).toBeVisible();
    expect(screen.getByText("Later line")).toBeVisible();
    const pageText = document.body.textContent ?? "";
    expect(pageText.indexOf("Earlier line")).toBeLessThan(
      pageText.indexOf("Later line")
    );
  });

  it("searches displayed song lyrics and highlights the match", async () => {
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
              id: "weston",
              referentId: "referent-weston",
              sortIndex: 0,
              fragment: "I finessed down Weston Road",
              annotation: "A reference to a Toronto street.",
              annotationHtml: null,
              sourceUrl: "https://genius.com/annotation/weston",
              state: "accepted",
              classification: "accepted",
              verified: false,
              votesTotal: 12,
              categories: ["verified-accepted"],
            },
            {
              id: "north",
              referentId: "referent-north",
              sortIndex: 1,
              fragment: "North side line",
              annotation: "Another reference.",
              annotationHtml: null,
              sourceUrl: "https://genius.com/annotation/north",
              state: "accepted",
              classification: "accepted",
              verified: false,
              votesTotal: 7,
              categories: ["verified-accepted"],
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
    await userEvent.click(
      await screen.findByRole("button", { name: /God's Plan/i })
    );

    expect(await screen.findByText("I finessed down Weston Road")).toBeVisible();
    expect(screen.getByText("North side line")).toBeVisible();

    await userEvent.type(screen.getByLabelText("Search lyrics"), "weston");

    expect(screen.getByText("1 match")).toBeVisible();
    expect(screen.queryByText("North side line")).not.toBeInTheDocument();
    expect(screen.getByText("Weston").tagName).toBe("MARK");
  });

  it("switches to album search", async () => {
    render(<ReferenceExplorer />);

    await userEvent.click(screen.getByRole("button", { name: "Album" }));

    expect(screen.getByPlaceholderText("e.g. Scorpion")).toBeVisible();
  });

  it("keeps matched album tracks visible when a filter has no references", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              type: "album",
              id: "1742292297",
              title: "WE STILL DON'T TRUST YOU",
              artist: "Future & Metro Boomin",
              artworkUrl: null,
              sourceUrl: "https://music.apple.com/album",
              metadata: {
                collectionId: 1742292297,
                trackCount: 25,
                releaseYear: "2024",
              },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          album: {
            type: "album",
            id: "1742292297",
            title: "WE STILL DON'T TRUST YOU",
            artist: "Future & Metro Boomin",
            artworkUrl: null,
            sourceUrl: "https://music.apple.com/album",
            metadata: {
              collectionId: 1742292297,
              trackCount: 25,
              releaseYear: "2024",
            },
          },
          tracks: [
            {
              track: {
                id: "1",
                title: "Filtered Out Track",
                artist: "Future & Metro Boomin",
                trackNumber: 1,
                discNumber: 1,
                explicitness: "explicit",
              },
              matchStatus: "matched",
              matchConfidence: 0.95,
              matchedSong: null,
              references: [
                {
                  id: "ref-1",
                  referentId: "referent-1",
                  sortIndex: 0,
                  fragment: "An unverified line",
                  annotation: "An unverified reference.",
                  annotationHtml: null,
                  sourceUrl: "https://genius.com/annotation",
                  state: null,
                  classification: null,
                  verified: false,
                  votesTotal: 4,
                  categories: [],
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
      "we still don't trust you"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("WE STILL DON'T TRUST YOU");
    await userEvent.click(
      screen.getByRole("button", { name: /WE STILL DON'T TRUST YOU/i })
    );

    const trackButton = await screen.findByRole("button", {
      name: /Filtered Out Track/i,
    });
    expect(trackButton).toBeVisible();
    expect(screen.getByText("0 refs")).toBeVisible();

    await userEvent.click(trackButton);

    expect(await screen.findByText("No references match this filter.")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: /Unverified/i }));

    expect(await screen.findByText("An unverified line")).toBeVisible();
  });

  it("renders safe annotation images without passing children to void tags", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              type: "song",
              id: "123",
              title: "Image Annotation",
              artist: "Test Artist",
              artworkUrl: null,
              sourceUrl: "https://genius.com/song",
              metadata: { geniusId: 123 },
            },
          ],
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          song: {
            type: "song",
            id: "123",
            title: "Image Annotation",
            artist: "Test Artist",
            artworkUrl: null,
            sourceUrl: "https://genius.com/song",
            metadata: { geniusId: 123 },
          },
          references: [
            {
              id: "1",
              referentId: "10",
              sortIndex: 0,
              fragment: "Annotated image line",
              annotation: "Annotation with image.",
              annotationHtml:
                '<p>Annotation with image.</p><figure><img src="https://images.genius.com/test.jpg" alt="Studio photo"></figure>',
              sourceUrl: "https://genius.com/annotation",
              state: "accepted",
              classification: "accepted",
              verified: false,
              votesTotal: 12,
              categories: ["verified-accepted"],
            },
          ],
          source: "live",
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReferenceExplorer />);

    await userEvent.type(
      screen.getByPlaceholderText("e.g. God's Plan"),
      "image annotation"
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.click(
      await screen.findByRole("button", { name: /Image Annotation/i })
    );

    expect(await screen.findByText("Annotation with image.")).toBeVisible();
    expect(screen.getByAltText("Studio photo")).toHaveAttribute(
      "src",
      "https://images.genius.com/test.jpg"
    );
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
                trackCount: 3,
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
              trackCount: 3,
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
                  sortIndex: 0,
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
                  sortIndex: 0,
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
            {
              track: {
                id: "3",
                title: "Missing Track",
                artist: "Drake",
                trackNumber: 3,
                discNumber: 1,
                explicitness: "explicit",
              },
              matchStatus: "unmatched",
              matchConfidence: null,
              matchedSong: null,
              references: [],
              error: "No confident Genius match found.",
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
    expect(screen.getAllByText("2018").length).toBeGreaterThan(0);
    expect(screen.getByText("3 tracks")).toBeVisible();
    expect(screen.getByRole("button", { name: /Missing Track/i })).toBeVisible();
    expect(screen.getByText("missing")).toBeVisible();
    expect(screen.queryByText("A hidden line")).not.toBeInTheDocument();
    expect(screen.queryByText("Another hidden line")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /First Track/i }));

    expect(await screen.findByText("A hidden line")).toBeVisible();
    expect(screen.queryByText("Another hidden line")).not.toBeInTheDocument();
  });

  it("searches album lyrics and opens matching tracks", async () => {
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
                title: "Matching Track",
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
                  id: "cash",
                  referentId: "referent-cash",
                  sortIndex: 0,
                  fragment: "Cash line in the hook",
                  annotation: "A matching reference.",
                  annotationHtml: null,
                  sourceUrl: "https://genius.com/annotation/cash",
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
                title: "Other Track",
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
                  id: "other",
                  referentId: "referent-other",
                  sortIndex: 0,
                  fragment: "Another lyric line",
                  annotation: "Another reference.",
                  annotationHtml: null,
                  sourceUrl: "https://genius.com/annotation/other",
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
    await userEvent.click(await screen.findByRole("button", { name: /Scorpion/i }));

    await screen.findByRole("button", { name: /Matching Track/i });
    expect(screen.queryByText("Cash line in the hook")).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Search lyrics"), "cash");

    expect(screen.getByText("1 match")).toBeVisible();
    expect(await screen.findByText("Cash")).toBeVisible();
    expect(screen.getByText("Cash").tagName).toBe("MARK");
    expect(screen.getByText(/line in the hook/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Other Track/i })
    ).not.toBeInTheDocument();
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
