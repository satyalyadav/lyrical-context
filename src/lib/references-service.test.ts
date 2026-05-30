import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetCacheForTests } from "@/lib/cache";
import {
  getGeniusSongReferences,
  searchGeniusSongs,
} from "@/lib/genius";
import { getITunesAlbumTracks } from "@/lib/itunes";
import {
  getAlbumReferenceResponse,
  MAX_ALBUM_TRACKS,
  search,
} from "@/lib/references-service";
import {
  getSpotifyAlbumTracks,
  searchSpotifyAlbums,
} from "@/lib/spotify";
import type {
  AlbumSearchResult,
  AlbumTrack,
  Reference,
  SongSearchResult,
} from "@/lib/types";

vi.mock("@/lib/genius", () => ({
  getGeniusSongDetails: vi.fn(),
  getGeniusSongReferences: vi.fn(),
  searchGeniusSongs: vi.fn(),
}));

vi.mock("@/lib/itunes", () => ({
  getITunesAlbumTracks: vi.fn(),
  searchITunesAlbums: vi.fn(),
}));

vi.mock("@/lib/spotify", () => ({
  decodeSpotifyAlbumId: (value: string) =>
    value.startsWith("spotify:") ? value.slice("spotify:".length) : null,
  getSpotifyAlbumTracks: vi.fn(),
  searchSpotifyAlbums: vi.fn(),
}));

describe("references service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LYRICAL_CONTEXT_DB_PATH = path.join(
      mkdtempSync(path.join(os.tmpdir(), "lyrical-context-service-")),
      "cache.sqlite"
    );
    resetCacheForTests();
  });

  afterEach(() => {
    resetCacheForTests();
    delete process.env.LYRICAL_CONTEXT_DB_PATH;
  });

  it("uses Spotify for album search", async () => {
    vi.mocked(searchSpotifyAlbums).mockResolvedValueOnce({
      value: [albumResult({ id: "spotify:3OBhnTLrvkoEEETjFA3Qfk" })],
      source: "live",
    });

    const results = await search("album", "history michael jackson");

    expect(results[0].id).toBe("spotify:3OBhnTLrvkoEEETjFA3Qfk");
    expect(searchSpotifyAlbums).toHaveBeenCalledWith("history michael jackson");
  });

  it("loads Spotify album tracklists for Spotify album ids", async () => {
    vi.mocked(getSpotifyAlbumTracks).mockResolvedValueOnce({
      value: {
        album: albumResult({ id: "spotify:3OBhnTLrvkoEEETjFA3Qfk" }),
        tracks: [albumTrack("spotify-track-1", "Scream", 1)],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockResolvedValue({
      value: [songResult("song-1", "Scream")],
      source: "live",
    });
    vi.mocked(getGeniusSongReferences).mockResolvedValue({
      value: [],
      source: "live",
    });

    const payload = await getAlbumReferenceResponse(
      "spotify:3OBhnTLrvkoEEETjFA3Qfk"
    );

    expect(payload.album.id).toBe("spotify:3OBhnTLrvkoEEETjFA3Qfk");
    expect(getSpotifyAlbumTracks).toHaveBeenCalledWith(
      "3OBhnTLrvkoEEETjFA3Qfk"
    );
    expect(getITunesAlbumTracks).not.toHaveBeenCalled();
  });

  it("searches a clean title variant for soundtrack theme tracks", async () => {
    vi.mocked(getSpotifyAlbumTracks).mockResolvedValueOnce({
      value: {
        album: albumResult({ id: "spotify:history" }),
        tracks: [
          albumTrack(
            "spotify-childhood",
            'Childhood - Theme from "Free Willy 2"',
            30
          ),
        ],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockImplementation(async (query) => ({
      value:
        query.toLocaleLowerCase() === "test artist childhood"
          ? [songResult("childhood", "Childhood")]
          : [],
      source: "live",
    }));
    vi.mocked(getGeniusSongReferences).mockResolvedValue({
      value: [referenceResult("childhood-reference")],
      source: "live",
    });

    const payload = await getAlbumReferenceResponse("spotify:history");

    expect(payload.tracks[0]).toMatchObject({
      matchStatus: "matched",
      matchedSong: {
        id: "childhood",
        title: "Childhood",
      },
    });
    expect(searchGeniusSongs).toHaveBeenCalledWith("Test Artist childhood", 8);
    expect(getGeniusSongReferences).toHaveBeenCalledWith(
      "childhood",
      expect.objectContaining({
        title: "Childhood",
        artist: "Test Artist",
      })
    );
  });

  it("keeps album tracks in order and skips reference work for unmatched tracks", async () => {
    vi.mocked(getITunesAlbumTracks).mockResolvedValueOnce({
      value: {
        album: albumResult(),
        tracks: [
          albumTrack("track-1", "First Song", 1),
          albumTrack("track-2", "No Match", 2),
          albumTrack("track-3", "Third Song", 3),
        ],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockImplementation(async (query) => {
      const normalizedQuery = query.toLocaleLowerCase();

      if (normalizedQuery.includes("first song")) {
        return { value: [songResult("song-1", "First Song")], source: "live" };
      }

      if (normalizedQuery.includes("third song")) {
        return { value: [songResult("song-3", "Third Song")], source: "live" };
      }

      return { value: [], source: "live" };
    });
    vi.mocked(getGeniusSongReferences).mockImplementation(async (songId) => ({
      value: [referenceResult(`${songId}-reference`)],
      source: "live",
    }));

    const payload = await getAlbumReferenceResponse("album-1");

    expect(payload.tracks.map(({ track }) => track.id)).toEqual([
      "track-1",
      "track-2",
      "track-3",
    ]);
    expect(payload.tracks.map(({ matchStatus }) => matchStatus)).toEqual([
      "matched",
      "unmatched",
      "matched",
    ]);
    expect(payload.tracks.map(({ references }) => references.length)).toEqual([
      1,
      0,
      1,
    ]);
    expect(getGeniusSongReferences).toHaveBeenCalledTimes(2);
    expect(getGeniusSongReferences).not.toHaveBeenCalledWith(
      expect.stringContaining("track-2"),
      expect.anything()
    );
  });

  it("rejects albums above the maximum track cap", async () => {
    vi.mocked(getITunesAlbumTracks).mockResolvedValueOnce({
      value: {
        album: albumResult(),
        tracks: Array.from({ length: MAX_ALBUM_TRACKS + 1 }, (_, index) =>
          albumTrack(`track-${index}`, `Track ${index}`, index + 1)
        ),
      },
      source: "live",
    });

    await expect(getAlbumReferenceResponse("album-1")).rejects.toThrowError(
      expect.objectContaining({
        code: "album_too_large",
        status: 413,
      })
    );
    expect(searchGeniusSongs).not.toHaveBeenCalled();
  });

  it("overlaps reference loading with remaining track matching while preserving order", async () => {
    type ResolveSecondSearch = (payload: {
      value: SongSearchResult[];
      source: "live";
    }) => void;
    const secondSearchBridge: { resolve: ResolveSecondSearch | null } = {
      resolve: null,
    };
    let secondSearchResolved = false;
    let referenceStartedBeforeSecondMatch = false;
    let signalReferenceStarted: (() => void) | null = null;
    const referenceStarted = new Promise<void>((resolve) => {
      signalReferenceStarted = resolve;
    });

    vi.mocked(getITunesAlbumTracks).mockResolvedValueOnce({
      value: {
        album: albumResult(),
        tracks: [
          albumTrack("track-1", "First Song", 1),
          albumTrack("track-2", "Second Song", 2),
          albumTrack("track-3", "Third Song", 3),
        ],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockImplementation(async (query) => {
      const normalizedQuery = query.toLocaleLowerCase();

      if (normalizedQuery.includes("second song")) {
        return new Promise((resolve) => {
          secondSearchBridge.resolve = (payload) => {
            secondSearchResolved = true;
            resolve(payload);
          };
        });
      }

      const title = normalizedQuery.includes("third song")
        ? "Third Song"
        : "First Song";

      return {
        value: [songResult(`song-${title}`, title)],
        source: "live",
      };
    });
    vi.mocked(getGeniusSongReferences).mockImplementation(async () => {
      if (!secondSearchResolved) {
        referenceStartedBeforeSecondMatch = true;
        secondSearchBridge.resolve?.({
          value: [songResult("song-Second Song", "Second Song")],
          source: "live",
        });
      }

      signalReferenceStarted?.();
      return { value: [], source: "live" };
    });

    const payloadPromise = getAlbumReferenceResponse("album-2");

    try {
      await Promise.race([
        referenceStarted,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Reference loading did not start.")), 1000)
        ),
      ]);
    } finally {
      secondSearchBridge.resolve?.({
        value: [songResult("song-Second Song", "Second Song")],
        source: "live",
      });
    }

    const payload = await payloadPromise;

    expect(referenceStartedBeforeSecondMatch).toBe(true);
    expect(payload.tracks.map(({ track }) => track.id)).toEqual([
      "track-1",
      "track-2",
      "track-3",
    ]);
  });

  it("retries Genius matching with simpler artist credits for featured album tracks", async () => {
    vi.mocked(getITunesAlbumTracks).mockResolvedValueOnce({
      value: {
        album: {
          ...albumResult(),
          artist: "Future & Metro Boomin",
        },
        tracks: [
          {
            ...albumTrack("track-1", "Luv Bad Bitches", 6),
            artist: "Future, Metro Boomin & Brownstone",
          },
        ],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockImplementation(async (query) => ({
      value:
        query === "Future luv bad bitches"
          ? [
              songResult("song-1", "Luv Bad Bitches", {
                artist: "Future",
              }),
            ]
          : [],
      source: "live",
    }));
    vi.mocked(getGeniusSongReferences).mockResolvedValue({
      value: [referenceResult("song-1-reference")],
      source: "live",
    });

    const payload = await getAlbumReferenceResponse("album-1");

    expect(payload.tracks[0]).toMatchObject({
      matchStatus: "matched",
      matchedSong: {
        title: "Luv Bad Bitches",
        artist: "Future",
      },
    });
    expect(searchGeniusSongs).toHaveBeenCalledWith(
      "Future luv bad bitches",
      8
    );
    expect(getGeniusSongReferences).toHaveBeenCalledWith(
      "song-1",
      expect.objectContaining({
        title: "Luv Bad Bitches",
        artist: "Future",
      })
    );
  });

  it("continues past translated Genius pages when a simpler query finds the song", async () => {
    vi.mocked(getITunesAlbumTracks).mockResolvedValueOnce({
      value: {
        album: {
          ...albumResult(),
          artist: "Future & Metro Boomin",
        },
        tracks: [
          {
            ...albumTrack("track-1", "Amazing (Interlude)", 7),
            artist: "Future & Metro Boomin",
          },
        ],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockImplementation(async (query) => ({
      value:
        query === "Future & Metro Boomin amazing interlude"
          ? [
              songResult(
                "translation-1",
                "Future & Metro Boomin - Amazing (Interlude) (Traducción al Español)",
                {
                  artist: "Genius Traducciones al Español",
                }
              ),
            ]
          : query === "Future amazing interlude"
            ? [
                songResult("song-1", "Amazing (Interlude)", {
                  artist: "Future",
                }),
              ]
            : [],
      source: "live",
    }));
    vi.mocked(getGeniusSongReferences).mockResolvedValue({
      value: [referenceResult("song-1-reference")],
      source: "live",
    });

    const payload = await getAlbumReferenceResponse("album-1");

    expect(payload.tracks[0]).toMatchObject({
      matchStatus: "matched",
      matchedSong: {
        id: "song-1",
        title: "Amazing (Interlude)",
      },
    });
    expect(searchGeniusSongs).toHaveBeenCalledWith(
      "Future amazing interlude",
      8
    );
  });

  it("tries punctuation-preserving title queries before split-initialism queries", async () => {
    vi.mocked(getITunesAlbumTracks).mockResolvedValueOnce({
      value: {
        album: {
          ...albumResult(),
          artist: "J. Cole",
        },
        tracks: [
          {
            ...albumTrack("track-1", "G.O.M.D", 8),
            artist: "J. Cole",
          },
        ],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockImplementation(async (query) => ({
      value:
        query === "J. Cole g.o.m.d"
          ? [
              songResult("song-1", "G.O.M.D.", {
                artist: "J. Cole",
              }),
            ]
          : [],
      source: "live",
    }));
    vi.mocked(getGeniusSongReferences).mockResolvedValue({
      value: [referenceResult("song-1-reference")],
      source: "live",
    });

    const payload = await getAlbumReferenceResponse("album-1");

    expect(payload.tracks[0]).toMatchObject({
      matchStatus: "matched",
      matchedSong: {
        id: "song-1",
        title: "G.O.M.D.",
      },
    });
    expect(searchGeniusSongs).toHaveBeenNthCalledWith(
      1,
      "J. Cole g.o.m.d",
      8
    );
    expect(searchGeniusSongs).not.toHaveBeenCalledWith(
      "J. Cole g o m d",
      8
    );
  });

  it("matches censored explicit titles against uncensored Genius titles", async () => {
    vi.mocked(getITunesAlbumTracks).mockResolvedValueOnce({
      value: {
        album: {
          ...albumResult(),
          artist: "Meek Mill",
        },
        tracks: [
          {
            ...albumTrack("track-1", "Wit the S***s (W.T.S) [feat. Melii]", 16),
            artist: "Meek Mill",
          },
        ],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockImplementation(async (query) => ({
      value:
        query === "Meek Mill wit the shits (w.t.s)"
          ? [
              songResult("song-1", "Wit the Shits (W.T.S)", {
                artist: "Meek Mill",
                metadata: {
                  geniusId: 1,
                  releaseYear: "2018",
                  albumTitle: "Championships",
                  featuredArtists: ["Melii"],
                },
              }),
            ]
          : [],
      source: "live",
    }));
    vi.mocked(getGeniusSongReferences).mockResolvedValue({
      value: [referenceResult("song-1-reference")],
      source: "live",
    });

    const payload = await getAlbumReferenceResponse("album-1");

    expect(payload.tracks[0]).toMatchObject({
      matchStatus: "matched",
      matchedSong: {
        id: "song-1",
        title: "Wit the Shits (W.T.S)",
        artist: "Meek Mill",
      },
    });
    expect(searchGeniusSongs).toHaveBeenNthCalledWith(
      1,
      "Meek Mill wit the shits (w.t.s)",
      8
    );
  });

  it("falls back to leading initialism queries for censored long titles", async () => {
    vi.mocked(getITunesAlbumTracks).mockResolvedValueOnce({
      value: {
        album: {
          ...albumResult(),
          artist: "Drake",
        },
        tracks: [
          {
            ...albumTrack(
              "track-1",
              "HYFR (Hell Ya F***ing Right) [feat. Lil Wayne]",
              16
            ),
            artist: "Drake",
          },
        ],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockImplementation(async (query) => ({
      value:
        query === "Drake hyfr"
          ? [
              songResult("song-1", "HYFR (Hell Ya Fucking Right)", {
                artist: "Drake",
                metadata: {
                  geniusId: 1,
                  releaseYear: "2011",
                  albumTitle: "Take Care",
                  featuredArtists: ["Lil Wayne"],
                },
              }),
            ]
          : [],
      source: "live",
    }));
    vi.mocked(getGeniusSongReferences).mockResolvedValue({
      value: [referenceResult("song-1-reference")],
      source: "live",
    });

    const payload = await getAlbumReferenceResponse("album-1");

    expect(payload.tracks[0]).toMatchObject({
      matchStatus: "matched",
      matchedSong: {
        id: "song-1",
        title: "HYFR (Hell Ya Fucking Right)",
        artist: "Drake",
      },
    });
    expect(searchGeniusSongs).toHaveBeenCalledWith("Drake hyfr", 8);
    expect(getGeniusSongReferences).toHaveBeenCalledWith(
      "song-1",
      expect.objectContaining({
        title: "HYFR (Hell Ya Fucking Right)",
        artist: "Drake",
      })
    );
  });

  it("matches stylized artist diacritics against Genius title spelling", async () => {
    vi.mocked(getITunesAlbumTracks).mockResolvedValueOnce({
      value: {
        album: {
          ...albumResult(),
          artist: "JAŸ-Z",
        },
        tracks: [
          {
            ...albumTrack("track-1", "Kill JAŸ-Z", 1),
            artist: "JAY-Z",
          },
        ],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockImplementation(async (query) => ({
      value:
        query === "JAY-Z kill jay-z"
          ? [
              songResult("song-1", "Kill Jay Z", {
                artist: "JAŸ-Z",
                metadata: {
                  geniusId: 1,
                  releaseYear: "2017",
                  albumTitle: "4:44",
                  featuredArtists: [],
                },
              }),
            ]
          : [],
      source: "live",
    }));
    vi.mocked(getGeniusSongReferences).mockResolvedValue({
      value: [referenceResult("song-1-reference")],
      source: "live",
    });

    const payload = await getAlbumReferenceResponse("album-1");

    expect(payload.tracks[0]).toMatchObject({
      matchStatus: "matched",
      matchedSong: {
        id: "song-1",
        title: "Kill Jay Z",
        artist: "JAŸ-Z",
      },
    });
  });

  it("strips bonus markers before searching Genius for album tracks", async () => {
    vi.mocked(getITunesAlbumTracks).mockResolvedValueOnce({
      value: {
        album: {
          ...albumResult(),
          artist: "J. Cole",
        },
        tracks: [
          {
            ...albumTrack("track-1", "Ocean Way (Bonus)", 12),
            artist: "J. Cole",
          },
        ],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockImplementation(async (query) => ({
      value:
        query === "J. Cole ocean way"
          ? [
              songResult("song-1", "Ocean Way", {
                artist: "J. Cole",
                metadata: {
                  geniusId: 1,
                  releaseYear: "2026",
                  albumTitle: "The Fall-Off",
                  featuredArtists: [],
                },
              }),
            ]
          : [],
      source: "live",
    }));
    vi.mocked(getGeniusSongReferences).mockResolvedValue({
      value: [referenceResult("song-1-reference")],
      source: "live",
    });

    const payload = await getAlbumReferenceResponse("album-1");

    expect(payload.tracks[0]).toMatchObject({
      matchStatus: "matched",
      matchedSong: {
        id: "song-1",
        title: "Ocean Way",
        artist: "J. Cole",
      },
    });
    expect(searchGeniusSongs).toHaveBeenNthCalledWith(
      1,
      "J. Cole ocean way",
      8
    );
  });

  it("caches unmatched track searches", async () => {
    vi.mocked(getITunesAlbumTracks).mockResolvedValue({
      value: {
        album: albumResult(),
        tracks: [albumTrack("track-1", "No Match", 1)],
      },
      source: "live",
    });
    vi.mocked(searchGeniusSongs).mockResolvedValue({
      value: [],
      source: "live",
    });

    await getAlbumReferenceResponse("album-1");
    await getAlbumReferenceResponse("album-1");

    expect(searchGeniusSongs).toHaveBeenCalledTimes(2);
    expect(getGeniusSongReferences).not.toHaveBeenCalled();
  });
});

function albumResult(overrides: Partial<AlbumSearchResult> = {}): AlbumSearchResult {
  return {
    type: "album",
    id: "album-1",
    title: "Test Album",
    artist: "Test Artist",
    artworkUrl: null,
    sourceUrl: "https://music.apple.com/album",
    metadata: {
      collectionId: 1,
      trackCount: 3,
      releaseYear: "2026",
    },
    ...overrides,
  };
}

function albumTrack(id: string, title: string, trackNumber: number): AlbumTrack {
  return {
    id,
    title,
    artist: "Test Artist",
    trackNumber,
    discNumber: 1,
    explicitness: null,
  };
}

function songResult(
  id: string,
  title: string,
  overrides: Partial<SongSearchResult> = {}
): SongSearchResult {
  return {
    type: "song",
    id,
    title,
    artist: "Test Artist",
    artworkUrl: null,
    sourceUrl: "https://genius.com/song",
    metadata: {
      geniusId: Number.parseInt(id.replace(/\D/g, ""), 10) || 1,
      releaseYear: "2026",
      albumTitle: "Test Album",
      featuredArtists: [],
    },
    ...overrides,
  };
}

function referenceResult(id: string): Reference {
  return {
    id,
    referentId: id,
    sortIndex: 0,
    fragment: "Annotated lyric",
    annotation: "Annotation body",
    annotationHtml: null,
    sourceUrl: "https://genius.com/reference",
    state: "accepted",
    classification: "accepted",
    verified: false,
    votesTotal: null,
    categories: [],
  };
}
