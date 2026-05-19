import { describe, expect, it } from "vitest";

import {
  detectReferenceCategories,
  normalizeTitle,
  normalizeTitleForSearch,
  stripHtml,
  truncateText,
} from "@/lib/text";

describe("text utilities", () => {
  it("normalizes featured and version title variants", () => {
    expect(normalizeTitle("Search & Rescue (feat. Drake) [Clean]")).toBe(
      "search rescue"
    );
  });

  it("normalizes edited and abbreviated clean title variants", () => {
    expect(normalizeTitle("You Had Me, You Lost Me (Edited)")).toBe(
      "you had me you lost me"
    );
    expect(normalizeTitle("Gangsta B's")).toBe("gangsta bitches");
    expect(normalizeTitle("A*****e (feat. Skylar Grey)")).toBe("asshole");
    expect(normalizeTitle("Wit the S***s (W.T.S) [feat. Melii]")).toBe(
      "wit the shits w t s"
    );
    expect(normalizeTitle("HYFR (Hell Ya F***ing Right)")).toBe(
      "hyfr hell ya fucking right"
    );
  });

  it("keeps punctuation that improves external title search", () => {
    expect(normalizeTitleForSearch("G.O.M.D (Edited)")).toBe("g.o.m.d");
    expect(normalizeTitleForSearch("A*****e (feat. Skylar Grey)")).toBe(
      "asshole"
    );
    expect(
      normalizeTitleForSearch("Wit the S***s (W.T.S) [feat. Melii]")
    ).toBe("wit the shits (w.t.s)");
    expect(normalizeTitleForSearch("HYFR (Hell Ya F***ing Right)")).toBe(
      "hyfr (hell ya fucking right)"
    );
  });

  it("strips simple Genius HTML bodies to readable text", () => {
    expect(stripHtml("<p>Line one<br>Line two &amp; three</p>")).toBe(
      "Line one Line two & three"
    );
  });

  it("truncates long text without changing short text", () => {
    expect(truncateText("short", 10)).toBe("short");
    expect(truncateText("a long annotation body", 8)).toBe("a long…");
  });

  it("detects reference categories from annotation text and metadata", () => {
    expect(
      detectReferenceCategories({
        fragment: "I hit Weston Road",
        annotation: "This line is a subliminal shot and references Toronto.",
        verified: false,
        state: "accepted",
        classification: null,
      })
    ).toEqual(["diss", "names-places", "verified-accepted"]);
  });
});
