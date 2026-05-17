import { describe, expect, it } from "vitest";

import {
  findFragmentLyricPosition,
  normalizeGeniusSong,
  normalizeReferent,
} from "@/lib/genius";

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
    const references = normalizeReferent(
      {
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
      },
      3000
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      id: "1",
      referentId: "99",
      sortIndex: 3000,
      categories: ["names-places", "verified-accepted"],
    });
  });

  it("preserves safe annotation images and strips scripts", () => {
    const references = normalizeReferent(
      {
        id: 100,
        fragment: "I been running the game",
        classification: "accepted",
        annotations: [
          {
            id: 2,
            state: "accepted",
            body: {
              plain: "Drake injury context.",
              html: `
              <p>Drake injury context.</p>
              <script>alert("bad")</script>
              <img src="https://images.genius.com/drake.jpg" alt="Drake training">
            `,
            },
          },
        ],
      },
      0
    );

    expect(references[0].sortIndex).toBe(0);
    expect(references[0].annotationHtml).toContain(
      'src="https://images.genius.com/drake.jpg"'
    );
    expect(references[0].annotationHtml).toContain('loading="lazy"');
    expect(references[0].annotationHtml).not.toContain("<script");
  });

  it("keeps multiple annotations for the same lyric fragment adjacent", () => {
    const references = normalizeReferent(
      {
        id: 101,
        fragment: "Two notes on one line",
        annotations: [
          {
            id: 10,
            body: { plain: "First annotation." },
          },
          {
            id: 11,
            body: { plain: "Second annotation." },
          },
        ],
      },
      4000
    );

    expect(references.map((reference) => reference.sortIndex)).toEqual([
      4000,
      4001,
    ]);
  });

  it("finds a Genius fragment position in plain lyrics", () => {
    expect(
      findFragmentLyricPosition(
        "Oh man\n Oh man, oh man\n Not again",
        "Oh man, oh man, oh man\nNot again\n\nYeah, I learned the game"
      )
    ).toBe(0);
  });

  it("finds fragments when Genius includes section labels", () => {
    expect(
      findFragmentLyricPosition(
        "I got the fest in five days and it's my shit\n Soon as a nigga hit the stage, they gon'\n \n [Chorus]\n They gon' ask if I can play this shit back to back",
        "I got the fest in five days and it's my shit\nSoon as a nigga hit the stage, they gon' ask if I can play this shit back to back"
      )
    ).toBe(0);
  });
});
