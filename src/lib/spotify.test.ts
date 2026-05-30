import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetCacheForTests } from "@/lib/cache";
import {
  getSpotifyAlbumTracks,
  normalizeSpotifyAlbum,
  resetSpotifyForTests,
  searchSpotifyAlbums,
} from "@/lib/spotify";

describe("Spotify API helpers", () => {
  beforeEach(() => {
    vi.stubEnv("SPOTIFY_CLIENT_ID", "client-id");
    vi.stubEnv("SPOTIFY_CLIENT_SECRET", "client-secret");
    process.env.LYRICAL_CONTEXT_DB_PATH = path.join(
      mkdtempSync(path.join(os.tmpdir(), "lyrical-context-spotify-")),
      "cache.sqlite"
    );
    resetCacheForTests();
    resetSpotifyForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetCacheForTests();
    resetSpotifyForTests();
    delete process.env.LYRICAL_CONTEXT_DB_PATH;
  });

  it("normalizes Spotify albums", () => {
    expect(
      normalizeSpotifyAlbum({
        id: "3OBhnTLrvkoEEETjFA3Qfk",
        name: "HIStory: Past, Present and Future, Book I",
        artists: [{ name: "Michael Jackson" }],
        external_urls: {
          spotify: "https://open.spotify.com/album/3OBhnTLrvkoEEETjFA3Qfk",
        },
        images: [
          {
            url: "https://i.scdn.co/image/cover",
            height: 640,
            width: 640,
          },
        ],
        release_date: "1995-06-20",
        total_tracks: 30,
      })
    ).toMatchObject({
      id: "spotify:3OBhnTLrvkoEEETjFA3Qfk",
      title: "HIStory: Past, Present and Future, Book I",
      artist: "Michael Jackson",
      artworkUrl: "https://i.scdn.co/image/cover",
      metadata: {
        collectionId: null,
        spotifyId: "3OBhnTLrvkoEEETjFA3Qfk",
        provider: "spotify",
        trackCount: 30,
        releaseYear: "1995",
      },
    });
  });

  it("searches albums through Spotify", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          albums: {
            items: [
              {
                id: "3OBhnTLrvkoEEETjFA3Qfk",
                name: "HIStory: Past, Present and Future, Book I",
                artists: [{ name: "Michael Jackson" }],
                external_urls: {
                  spotify: "https://open.spotify.com/album/3OBhnTLrvkoEEETjFA3Qfk",
                },
                images: [],
                release_date: "1995-06-20",
                total_tracks: 30,
              },
            ],
          },
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { value } = await searchSpotifyAlbums("history michael jackson");

    expect(value[0].id).toBe("spotify:3OBhnTLrvkoEEETjFA3Qfk");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/v1/search?q=history%20michael%20jackson"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer token" }),
      })
    );
  });

  it("loads and paginates Spotify album tracks", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ access_token: "token", expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "album-id",
          name: "Album",
          artists: [{ name: "Artist" }],
          total_tracks: 2,
          tracks: {
            items: [spotifyTrack("track-1", "First Song", 1)],
            next: "https://api.spotify.com/v1/albums/album-id/tracks?offset=1",
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [spotifyTrack("track-2", "Second Song", 2)],
          next: null,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const { value } = await getSpotifyAlbumTracks("album-id");

    expect(value.tracks.map((track) => track.title)).toEqual([
      "First Song",
      "Second Song",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function spotifyTrack(id: string, name: string, trackNumber: number) {
  return {
    id,
    name,
    artists: [{ name: "Artist" }],
    disc_number: 1,
    track_number: trackNumber,
    explicit: false,
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
