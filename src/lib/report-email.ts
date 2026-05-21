import "server-only";

import { fetchWithTimeout, readResponseText } from "@/lib/http";
import type { IssueReportRecord } from "@/lib/issue-reports";

export async function notifyIssueReportByEmail(report: IssueReportRecord) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const notifyEmail = process.env.LYRICAL_CONTEXT_REPORT_NOTIFY_EMAIL?.trim();
  const fromEmail =
    process.env.RESEND_FROM_EMAIL?.trim() ?? "Lyrical Context <onboarding@resend.dev>";

  if (!apiKey || !notifyEmail) {
    return { sent: false as const, reason: "not_configured" as const };
  }

  const response = await fetchWithTimeout(
    "https://api.resend.com/emails",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [notifyEmail],
        subject: `[Lyrical Context] ${formatKind(report.kind)}`,
        text: formatReportEmailBody(report),
      }),
      cache: "no-store",
    },
    5_000
  );

  if (!response.ok) {
    const body = await readResponseText(response, 16 * 1024).catch(() => "");
    console.error("Issue report email failed:", response.status, body);
    return { sent: false as const, reason: "send_failed" as const };
  }

  return { sent: true as const };
}

function formatKind(kind: IssueReportRecord["kind"]) {
  switch (kind) {
    case "load_failed":
      return "Failed to load";
    case "missing_match":
      return "Missing or wrong match";
    default:
      return "Other issue";
  }
}

function formatReportEmailBody(report: IssueReportRecord) {
  const lines = [
    `Report ID: ${report.id}`,
    `Time: ${report.createdAt}`,
    `Type: ${formatKind(report.kind)}`,
  ];

  if (report.note) {
    lines.push("", "User note:", report.note);
  }

  const { context } = report;

  if (context.query || context.searchType) {
    lines.push("", "Search:", `${context.searchType ?? "unknown"} — ${context.query ?? ""}`);
  }

  if (context.selection) {
    lines.push(
      "",
      "Selection:",
      `${context.selection.type}: ${context.selection.title} — ${context.selection.artist} (${context.selection.id})`
    );
  }

  if (context.errorMessage) {
    lines.push("", "Error:", context.errorMessage);
  }

  if (context.pageUrl) {
    lines.push("", "Page:", context.pageUrl);
  }

  return lines.join("\n");
}
