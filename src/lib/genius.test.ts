import { describe, expect, it } from "vitest";

import { normalizeGeniusSong, normalizeReferent } from "@/lib/genius";

describe("Genius normalizers", () => {
  it("normalizes search results without lyrics", () => {
    expect(
      normalizeGeniusSong({
        id: 3315890,
        title: "God's Plan",
        url: "https://genius.com/Drake-gods-plan-lyrics",
        song_art_image_thumbnail_url: "https://images.genius.com/art.jpg",
        primary_artist: { name: "Drake" },
      })
    ).toEqual({
      type: "song",
      id: "3315890",
      title: "God's Plan",
      artist: "Drake",
      artworkUrl: "https://images.genius.com/art.jpg",
      sourceUrl: "https://genius.com/Drake-gods-plan-lyrics",
      metadata: { geniusId: 3315890 },
    });
  });

  it("normalizes referents into compact reference cards", () => {
    const references = normalizeReferent({
      id: 99,
      fragment: "I finessed down Weston Road",
      classification: "accepted",
      annotations: [
        {
          id: 1,
          url: "https://genius.com/1",
          state: "accepted",
          body: {
            plain: "Weston Road is a Toronto location connected to Drake.",
          },
        },
      ],
    });

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      id: "1",
      referentId: "99",
      categories: ["names-places", "verified-accepted"],
    });
  });
});
