import type { IssueReportContext } from "@/lib/issue-reports";
import type { SearchResult, SearchType } from "@/lib/types";

export type ReportableDetailState =
  | { type: "idle" }
  | { type: "loading"; result: SearchResult }
  | { type: "error"; result: SearchResult; message: string }
  | { type: "song"; result: SearchResult }
  | { type: "album"; result: SearchResult };

export function buildReportContext({
  searchType,
  query,
  detail,
  pageUrl,
}: {
  searchType: SearchType;
  query: string;
  detail: ReportableDetailState;
  pageUrl?: string | null;
}): IssueReportContext {
  const selection = getSelection(detail);

  return {
    searchType,
    query: query.trim() || null,
    selection,
    errorMessage: detail.type === "error" ? detail.message : null,
    pageUrl: pageUrl ?? null,
  };
}

function getSelection(detail: ReportableDetailState): IssueReportContext["selection"] {
  if (detail.type === "idle") {
    return null;
  }

  return {
    type: detail.result.type,
    title: detail.result.title,
    artist: detail.result.artist,
    id: detail.result.id,
  };
}
