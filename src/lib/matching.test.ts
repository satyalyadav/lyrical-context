import { describe, expect, it } from "vitest";

import { pickBestSongMatch, scoreSongMatch } from "@/lib/matching";
import type { AlbumTrack, SongSearchResult } from "@/lib/types";

const track: AlbumTrack = {
  id: "1",
  title: "First Person Shooter (feat. J. Cole)",
  artist: "Drake",
  trackNumber: 1,
  discNumber: 1,
  explicitness: "explicit",
};

function song(overrides: Partial<SongSearchResult>): SongSearchResult {
  return {
    type: "song",
    id: "123",
    title: "First Person Shooter",
    artist: "Drake",
    artworkUrl: null,
    sourceUrl: "https://genius.com/example",
    metadata: {
      geniusId: 123,
    },
    ...overrides,
  };
}

describe("song matching", () => {
  it("scores exact title matches with featured variants highly", () => {
    expect(scoreSongMatch(track, song({}))).toBeGreaterThanOrEqual(0.9);
  });

  it("chooses the strongest candidate", () => {
    const match = pickBestSongMatch(track, [
      song({ id: "wrong", title: "Another Song", artist: "Drake" }),
      song({ id: "right", title: "First Person Shooter", artist: "Drake" }),
    ]);

    expect(match?.song.id).toBe("right");
  });

  it("rejects weak matches", () => {
    const match = pickBestSongMatch(track, [
      song({ id: "wrong", title: "Completely Different", artist: "Future" }),
    ]);

    expect(match).toBeNull();
  });
});
