import { assertApiAccess } from "@/lib/api-guard";
import { toPublicError, LyricalContextError } from "@/lib/errors";
import {
  type IssueReportContext,
  type IssueReportKind,
  saveIssueReport,
} from "@/lib/issue-reports";
import { notifyIssueReportByEmail } from "@/lib/report-email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPORT_KINDS = new Set<IssueReportKind>([
  "load_failed",
  "missing_match",
  "other",
]);

export async function POST(request: Request) {
  try {
    assertApiAccess(request);

    const payload = (await request.json()) as {
      kind?: unknown;
      note?: unknown;
      context?: unknown;
    };

    const kind = payload.kind;

    if (typeof kind !== "string" || !REPORT_KINDS.has(kind as IssueReportKind)) {
      throw new LyricalContextError(
        "invalid_report_kind",
        "Choose what went wrong before submitting.",
        400
      );
    }

    const reportKind = kind as IssueReportKind;
    const note =
      typeof payload.note === "string" ? payload.note.trim().slice(0, 500) : "";

    if (reportKind === "other" && !note) {
      throw new LyricalContextError(
        "missing_report_note",
        "Please describe what went wrong.",
        400
      );
    }

    const record = await saveIssueReport({
      kind: reportKind,
      note: note || null,
      context: normalizeContext(payload.context),
    });

    const emailResult = await notifyIssueReportByEmail(record).catch((error) => {
      console.error("Issue report email notification failed:", error);
      return { sent: false as const, reason: "send_failed" as const };
    });

    return Response.json({
      ok: true,
      id: record.id,
      emailSent: emailResult.sent,
    });
  } catch (error) {
    const publicError = toPublicError(error);
    return Response.json(publicError.body, { status: publicError.status });
  }
}

function normalizeContext(value: unknown): IssueReportContext {
  if (!value || typeof value !== "object") {
    return {};
  }

  const context = value as Record<string, unknown>;
  const searchType =
    context.searchType === "song" || context.searchType === "album"
      ? context.searchType
      : null;

  let selection: IssueReportContext["selection"] = null;

  if (context.selection && typeof context.selection === "object") {
    const rawSelection = context.selection as Record<string, unknown>;
    const type = rawSelection.type === "song" || rawSelection.type === "album"
      ? rawSelection.type
      : null;
    const title = typeof rawSelection.title === "string" ? rawSelection.title.trim() : "";
    const artist = typeof rawSelection.artist === "string" ? rawSelection.artist.trim() : "";
    const id = typeof rawSelection.id === "string" ? rawSelection.id.trim() : "";

    if (type && title && artist && id) {
      selection = { type, title, artist, id };
    }
  }

  return {
    searchType,
    query: typeof context.query === "string" ? context.query.trim().slice(0, 200) : null,
    selection,
    errorMessage:
      typeof context.errorMessage === "string"
        ? context.errorMessage.trim().slice(0, 500)
        : null,
    pageUrl:
      typeof context.pageUrl === "string" ? context.pageUrl.trim().slice(0, 500) : null,
  };
}
