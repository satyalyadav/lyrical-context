import type { IssueReportContext, IssueReportKind } from "@/lib/issue-reports";

const DEFAULT_REPO = "satyalyadav/lyrical-context";
const ISSUE_TEMPLATE = "content_report.yml";

export function getGitHubIssuesUrl(
  context: IssueReportContext,
  kind: IssueReportKind = "other"
) {
  const repository =
    process.env.NEXT_PUBLIC_GITHUB_REPO?.trim() ||
    process.env.GITHUB_REPO?.trim() ||
    DEFAULT_REPO;

  const url = new URL(`https://github.com/${repository}/issues/new`);
  url.searchParams.set("template", ISSUE_TEMPLATE);
  url.searchParams.set("title", buildIssueTitle(context, kind));
  url.searchParams.set("body", buildIssueBody(context, kind));
  return url.toString();
}

function buildIssueTitle(context: IssueReportContext, kind: IssueReportKind) {
  const label = kindLabel(kind);
  const subject =
    context.selection?.title || context.query?.trim() || "Lyrical Context";

  return `${label}: ${subject}`.slice(0, 120);
}

function buildIssueBody(context: IssueReportContext, kind: IssueReportKind) {
  const lines = [
    `**Type:** ${kindLabel(kind)}`,
    "",
    "<!-- The fields below are prefilled when you open this link from the app. Edit as needed. -->",
    "",
  ];

  if (context.selection) {
    lines.push(
      `**Song or album:** ${context.selection.title} — ${context.selection.artist}`,
      `**ID:** ${context.selection.id} (${context.selection.type})`
    );
  } else if (context.query) {
    lines.push(`**Search:** ${context.query}`);
  }

  lines.push("");

  if (context.errorMessage) {
    lines.push(`**What happened:** ${context.errorMessage}`, "");
  } else {
    lines.push("**What happened:**", "", "**What you expected:**", "");
  }

  return lines.join("\n");
}

function kindLabel(kind: IssueReportKind) {
  switch (kind) {
    case "load_failed":
      return "Failed to load";
    case "missing_match":
      return "Missing or wrong match";
    default:
      return "Other";
  }
}
