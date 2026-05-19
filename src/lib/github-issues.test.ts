import { describe, expect, it } from "vitest";

import { getGitHubIssuesUrl } from "@/lib/github-issues";

describe("getGitHubIssuesUrl", () => {
  it("builds a GitHub issue URL with template and context", () => {
    const url = new URL(
      getGitHubIssuesUrl(
        {
          searchType: "album",
          query: "Take Care",
          selection: {
            type: "album",
            title: "Take Care",
            artist: "Drake",
            id: "123",
          },
          errorMessage: "No confident Genius match found.",
        },
        "missing_match"
      )
    );

    expect(url.hostname).toBe("github.com");
    expect(url.pathname).toBe("/satyalyadav/lyrical-context/issues/new");
    expect(url.searchParams.get("template")).toBe("content_report.yml");
    expect(url.searchParams.get("title")).toContain("Missing or wrong match");
    expect(url.searchParams.get("body")).toContain("Take Care");
  });
});
