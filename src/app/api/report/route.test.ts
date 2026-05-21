import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetApiGuardForTests } from "@/lib/api-guard";
import {
  getLocalIssueReportsForTests,
  resetIssueReportsForTests,
} from "@/lib/issue-reports";

vi.mock("@/lib/report-email", () => ({
  notifyIssueReportByEmail: vi.fn().mockResolvedValue({ sent: false, reason: "not_configured" }),
}));

import { notifyIssueReportByEmail } from "@/lib/report-email";
import { POST } from "./route";

describe("POST /api/report", () => {
  beforeEach(() => {
    resetApiGuardForTests();
    resetIssueReportsForTests();
    vi.clearAllMocks();
    delete process.env.LYRICAL_CONTEXT_API_KEY;
    delete process.env.LYRICAL_CONTEXT_REQUIRE_API_SESSION;
    delete process.env.LYRICAL_CONTEXT_SESSION_SECRET;
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

  it("rejects session-required requests before storing or emailing reports", async () => {
    vi.stubEnv("LYRICAL_CONTEXT_REQUIRE_API_SESSION", "true");
    process.env.LYRICAL_CONTEXT_SESSION_SECRET = "0123456789abcdef0123456789abcdef";

    const response = await POST(
      new Request("https://app.test/api/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({
          kind: "load_failed",
          note: "Album page failed",
          context: {},
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("forbidden");
    expect(getLocalIssueReportsForTests()).toHaveLength(0);
    expect(notifyIssueReportByEmail).not.toHaveBeenCalled();
  });

  it("rejects non-JSON report bodies", async () => {
    const response = await POST(
      new Request("http://app.test/api/report", {
        method: "POST",
        body: "kind=other",
      })
    );
    const body = await response.json();

    expect(response.status).toBe(415);
    expect(body.error.code).toBe("unsupported_media_type");
  });

  it("rejects cross-origin report page URLs", async () => {
    const response = await POST(
      new Request("http://app.test/api/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "load_failed",
          context: { pageUrl: "https://evil.test/report" },
        }),
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("invalid_url");
  });
});
