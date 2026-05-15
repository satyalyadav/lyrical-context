import { describe, expect, it } from "vitest";

import { normalizeITunesAlbum, normalizeITunesTrack } from "@/lib/itunes";

describe("iTunes normalizers", () => {
  it("normalizes album search records", () => {
    expect(
      normalizeITunesAlbum({
        wrapperType: "collection",
        collectionId: 1,
        collectionName: "Scorpion",
        artistName: "Drake",
        artworkUrl100: "https://is1-ssl.mzstatic.com/image/100x100bb.jpg",
        collectionViewUrl: "https://music.apple.com/album",
        releaseDate: "2018-06-29T07:00:00Z",
        trackCount: 25,
      })
    ).toMatchObject({
      type: "album",
      id: "1",
      title: "Scorpion",
      artist: "Drake",
      metadata: { collectionId: 1, trackCount: 25, releaseYear: "2018" },
    });
  });

  it("normalizes tracklist records", () => {
    expect(
      normalizeITunesTrack({
        wrapperType: "track",
        trackId: 2,
        trackName: "Nonstop",
        artistName: "Drake",
        trackNumber: 2,
        discNumber: 1,
        trackExplicitness: "explicit",
      })
    ).toEqual({
      id: "2",
      title: "Nonstop",
      artist: "Drake",
      trackNumber: 2,
      discNumber: 1,
      explicitness: "explicit",
    });
  });
});
