import { afterEach, describe, expect, it } from "vitest";

import {
  getLocalIssueReportsForTests,
  resetIssueReportsForTests,
  saveIssueReport,
} from "@/lib/issue-reports";

describe("saveIssueReport", () => {
  afterEach(() => {
    resetIssueReportsForTests();
  });

  it("stores reports in local memory during development", async () => {
    const record = await saveIssueReport({
      kind: "missing_match",
      note: " HYFR did not match ",
      context: {
        searchType: "album",
        query: "Take Care",
        selection: {
          type: "album",
          title: "Take Care",
          artist: "Drake",
          id: "123",
        },
      },
    });

    expect(record.id).toBeTruthy();
    expect(record.note).toBe("HYFR did not match");
    expect(getLocalIssueReportsForTests()[0]?.kind).toBe("missing_match");
  });
});
