import "server-only";

import { getRedisConfig, redisString, runRedisPipeline } from "@/lib/redis";

export type IssueReportKind = "load_failed" | "missing_match" | "other";

export type IssueReportContext = {
  searchType?: "song" | "album" | null;
  query?: string | null;
  selection?: {
    type: "song" | "album";
    title: string;
    artist: string;
    id: string;
  } | null;
  errorMessage?: string | null;
  pageUrl?: string | null;
};

export type IssueReportInput = {
  kind: IssueReportKind;
  note?: string | null;
  context: IssueReportContext;
};

export type IssueReportRecord = IssueReportInput & {
  id: string;
  createdAt: string;
};

const REPORTS_LIST_KEY = "lyrical-context:reports";
const MAX_STORED_REPORTS = 500;

const localReports: IssueReportRecord[] = [];

export async function saveIssueReport(input: IssueReportInput) {
  const record: IssueReportRecord = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    kind: input.kind,
    note: sanitizeNote(input.note),
    context: input.context,
  };

  const redis = getRedisConfig();
  const serialized = JSON.stringify(record);

  if (redis) {
    await runRedisPipeline(redis, [
      ["LPUSH", REPORTS_LIST_KEY, redisString(serialized)],
      ["LTRIM", REPORTS_LIST_KEY, "0", String(MAX_STORED_REPORTS - 1)],
    ]);
    return record;
  }

  localReports.unshift(record);

  if (localReports.length > MAX_STORED_REPORTS) {
    localReports.length = MAX_STORED_REPORTS;
  }

  return record;
}

export function resetIssueReportsForTests() {
  localReports.length = 0;
}

export function getLocalIssueReportsForTests() {
  return [...localReports];
}

function sanitizeNote(value: string | null | undefined) {
  const trimmed = value?.trim() ?? "";

  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 500);
}
