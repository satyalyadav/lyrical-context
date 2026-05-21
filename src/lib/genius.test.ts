import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetCacheForTests } from "@/lib/cache";
import {
  findFragmentLyricPosition,
  getGeniusSongReferences,
  normalizeGeniusSong,
  normalizeReferent,
} from "@/lib/genius";

describe("Genius normalizers", () => {
  const originalGeniusAccessToken = process.env.GENIUS_ACCESS_TOKEN;

  beforeEach(() => {
    process.env.GENIUS_ACCESS_TOKEN = "test-token";
    process.env.LYRICAL_CONTEXT_DB_PATH = path.join(
      mkdtempSync(path.join(os.tmpdir(), "lyrical-context-genius-")),
      "cache.sqlite"
    );
    resetCacheForTests();
  });

  afterEach(() => {
    resetCacheForTests();
    delete process.env.LYRICAL_CONTEXT_DB_PATH;

    if (originalGeniusAccessToken) {
      process.env.GENIUS_ACCESS_TOKEN = originalGeniusAccessToken;
    } else {
      delete process.env.GENIUS_ACCESS_TOKEN;
    }
  });

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
      metadata: {
        geniusId: 3315890,
        releaseYear: null,
        albumTitle: null,
        featuredArtists: [],
      },
    });
  });

  it("normalizes song metadata for the selected header", () => {
    expect(
      normalizeGeniusSong({
        id: 3876994,
        title: "SICKO MODE",
        url: "https://genius.com/Travis-scott-sicko-mode-lyrics",
        release_date_for_display: "August 3, 2018",
        album: { name: "ASTROWORLD" },
        featured_artists: [{ name: "Drake" }, { name: null }],
        primary_artist: { name: "Travis Scott" },
      })
    ).toMatchObject({
      metadata: {
        geniusId: 3876994,
        releaseYear: "2018",
        albumTitle: "ASTROWORLD",
        featuredArtists: ["Drake"],
      },
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

  it("strips annotation images and scripts", () => {
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
    expect(references[0].annotationHtml).not.toContain("<img");
    expect(references[0].annotationHtml).not.toContain("images.genius.com");
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

  it("finds short fragments when a lyric source uses a nearby wording variant", () => {
    expect(
      findFragmentLyricPosition(
        "Wet like I’m Lizzie",
        "See the shots that I took, wet like I'm Book\nWet like I'm Lindsey, I be spinning Valley"
      )
    ).toBeGreaterThan(0);
  });

  it("finds fragments across dropped-g wording differences", () => {
    expect(
      findFragmentLyricPosition(
        "I be spinnin’ Valley, circle blocks ’til I’m dizzy (Yeah, what?)",
        "Wet like I'm Lizzie, I be spinning Valley, circle blocks til I'm dizzy"
      )
    ).toBeGreaterThan(0);
  });

  it("finds fragments across adjacent-word spacing differences", () => {
    expect(
      findFragmentLyricPosition(
        "Young La Flame, he in sicko mode",
        "Going on you with the pick and roll, young laflame he in sicko mode"
      )
    ).toBeGreaterThan(0);
  });

  it("finds a bounded multiline chunk inside a very long fragment", () => {
    const unrelatedLines = Array.from(
      { length: 40 },
      (_, index) => `Unrelated credit line ${index}`
    ).join("\n");

    expect(
      findFragmentLyricPosition(
        `${unrelatedLines}
Target alpha
Target beta
Target gamma
Target delta
${unrelatedLines}`,
        "Intro line\nTarget alpha\nTarget beta\nTarget gamma\nTarget delta\nOutro line"
      )
    ).toBeGreaterThan(0);
  });

  it("orders references using another lyric source when the first one misses a fragment", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith("https://api.genius.com/referents")) {
          return jsonResponse({
            response: {
              referents: [
                geniusReferent({
                  id: 1,
                  fragment: "First annotated line",
                  annotation: "First annotation.",
                }),
                geniusReferent({
                  id: 2,
                  fragment: "Second annotated line",
                  annotation: "Second annotation.",
                }),
              ],
            },
          });
        }

        if (url.startsWith("https://lrclib.net/api/get")) {
          return jsonResponse({
            plainLyrics: "First annotated line\nUnrelated lyric source variant",
          });
        }

        if (url.startsWith("https://api.lyrics.ovh/v1")) {
          return jsonResponse({
            lyrics: "First annotated line\nSecond annotated line",
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      })
    );

    const { value: references } = await getGeniusSongReferences("song-id", {
      title: "Example Song",
      artist: "Example Artist",
    });

    expect(references.map((reference) => reference.fragment)).toEqual([
      "First annotated line",
      "Second annotated line",
    ]);
    expect(references[1].sortIndex).toBeLessThan(1_000_000_000);
  });
});

function geniusReferent({
  id,
  fragment,
  annotation,
}: {
  id: number;
  fragment: string;
  annotation: string;
}) {
  return {
    id,
    fragment,
    classification: "accepted",
    annotations: [
      {
        id,
        state: "accepted",
        body: {
          plain: annotation,
        },
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
