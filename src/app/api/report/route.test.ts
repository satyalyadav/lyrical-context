import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiGuardForTests } from "@/lib/api-guard";
import { resetIssueReportsForTests } from "@/lib/issue-reports";

vi.mock("@/lib/report-email", () => ({
  notifyIssueReportByEmail: vi.fn().mockResolvedValue({ sent: false, reason: "not_configured" }),
}));

import { notifyIssueReportByEmail } from "@/lib/report-email";
import { POST } from "./route";

describe("POST /api/report", () => {
  beforeEach(() => {
    resetApiGuardForTests();
    resetIssueReportsForTests();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
    delete process.env.LYRICAL_CONTEXT_REQUIRE_API_SESSION;
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    resetApiGuardForTests();
    resetIssueReportsForTests();
    vi.unstubAllEnvs();
  });

  it("stores a report and returns success", async () => {
    const response = await POST(
      new Request("http://app.test/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "load_failed",
          note: "Album page failed",
          context: {
            searchType: "album",
            query: "Views",
            selection: {
              type: "album",
              title: "Views",
              artist: "Drake",
              id: "999",
            },
            errorMessage: "Something went wrong",
          },
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
    expect(notifyIssueReportByEmail).toHaveBeenCalledOnce();
  });

  it("requires a note when the report kind is other", async () => {
    const response = await POST(
      new Request("http://app.test/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "other", note: "   ", context: {} }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("missing_report_note");
  });

  it("rejects invalid report kinds", async () => {
    const response = await POST(
      new Request("http://app.test/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "nope", context: {} }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_report_kind");
  });
});
