"use client";

import { ExternalLink, Flag, Loader2, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { getApiRequestHeaders } from "@/lib/api-client";
import { getGitHubIssuesUrl } from "@/lib/github-issues";
import type { IssueReportKind } from "@/lib/issue-reports";
import { buildReportContext } from "@/lib/report-context";
import type { ApiErrorBody, SearchType } from "@/lib/types";
import type { ReportableDetailState } from "@/lib/report-context";

const REPORT_OPTIONS: Array<{ value: IssueReportKind; label: string }> = [
  { value: "load_failed", label: "Something failed to load" },
  { value: "missing_match", label: "Song or album is missing / wrong match" },
  { value: "other", label: "Something else" },
];

export function ReportIssueDialog({
  searchType,
  query,
  detail,
}: {
  searchType: SearchType;
  query: string;
  detail: ReportableDetailState;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<IssueReportKind>("missing_match");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const context = useMemo(
    () =>
      buildReportContext({
        searchType,
        query,
        detail,
        pageUrl: typeof window === "undefined" ? null : window.location.href,
      }),
    [detail, query, searchType]
  );

  const githubUrl = useMemo(() => getGitHubIssuesUrl(context, kind), [context, kind]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const noteRequired = kind === "other";
  const trimmedNote = note.trim();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setStatus("idle");
    setErrorMessage(null);

    if (noteRequired && !trimmedNote) {
      setStatus("error");
      setErrorMessage("Please describe what went wrong.");
      setSubmitting(false);
      return;
    }

    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getApiRequestHeaders(),
        },
        body: JSON.stringify({
          kind,
          note: trimmedNote || null,
          context,
        }),
      });

      const payload = (await response.json()) as { ok?: boolean } & ApiErrorBody;

      if (!response.ok) {
        throw new Error(payload.error?.message ?? "Could not send your report.");
      }

      setStatus("success");
      setNote("");
    } catch (submitError) {
      setStatus("error");
      setErrorMessage(
        submitError instanceof Error
          ? submitError.message
          : "Could not send your report."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        className="flex w-full items-center justify-center gap-2 rounded border border-[#c8c7bf] bg-[#f0eee9] px-3 py-2 text-sm font-medium text-[#1b1c19] transition hover:bg-[#e8e6e1]"
        type="button"
        onClick={() => {
          setKind(getDefaultReportKind(detail));
          setOpen(true);
          setStatus("idle");
          setErrorMessage(null);
        }}
      >
        <Flag className="size-4" aria-hidden="true" />
        Report an issue
      </button>

      {open ? (
        <DialogOverlay onClose={() => setOpen(false)}>
          <DialogPanel ariaLabelledBy={titleId} onClose={() => setOpen(false)}>
            {status === "success" ? (
              <div className="space-y-4 p-5">
                <p className="text-sm text-[#1b1c19]">
                  Thanks — your report was sent. We will use it to improve matching and loading.
                </p>
                <button
                  className="rounded bg-[#181916] px-4 py-2 text-sm font-medium text-white"
                  type="button"
                  onClick={() => setOpen(false)}
                >
                  Close
                </button>
              </div>
            ) : (
              <form className="space-y-4 p-5" onSubmit={handleSubmit}>
                <ReportContextSummary context={context} />

                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium text-[#1b1c19]">What went wrong?</span>
                  <select
                    className="h-10 w-full rounded border border-[#c8c7bf] bg-[#fbf9f4] px-3 text-sm outline-none focus:border-[#181916]"
                    value={kind}
                    onChange={(event) => setKind(event.target.value as IssueReportKind)}
                  >
                    {REPORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1.5 text-sm">
                  <span className="font-medium text-[#1b1c19]">
                    {noteRequired ? "What went wrong?" : "Anything else?"}{" "}
                    {!noteRequired ? (
                      <span className="font-normal text-[#777770]">(optional)</span>
                    ) : null}
                  </span>
                  <textarea
                    className="min-h-20 w-full rounded border border-[#c8c7bf] bg-[#fbf9f4] px-3 py-2 text-sm outline-none focus:border-[#181916]"
                    maxLength={500}
                    placeholder={
                      noteRequired
                        ? "Tell us what you expected."
                        : "A short note is enough."
                    }
                    required={noteRequired}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>

                {errorMessage ? (
                  <p className="text-sm text-[#8f2f2f]" role="alert">
                    {errorMessage}
                  </p>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <button
                    className="inline-flex items-center justify-center gap-2 rounded bg-[#181916] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#2d2d2a] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={submitting || (noteRequired && !trimmedNote)}
                    type="submit"
                  >
                    {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                    Send report
                  </button>
                  <button
                    className="rounded border border-[#c8c7bf] px-4 py-2 text-sm font-medium text-[#1b1c19] transition hover:border-[#181916] hover:bg-[#e8e6e1]"
                    type="button"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            <div className="border-t border-[#c8c7bf] bg-[#f5f3ee] px-5 py-4 text-sm text-[#555550]">
              Comfortable with GitHub?{" "}
              <a
                className="inline-flex items-center gap-1 font-medium text-[#181916] underline-offset-2 hover:underline"
                href={githubUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Create an issue there
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            </div>
          </DialogPanel>
        </DialogOverlay>
      ) : null}
    </>
  );
}

function ReportContextSummary({
  context,
}: {
  context: ReturnType<typeof buildReportContext>;
}) {
  const lines: string[] = [];

  if (context.searchType && context.query) {
    lines.push(`${context.searchType === "song" ? "Song" : "Album"} search: ${context.query}`);
  }

  if (context.selection) {
    lines.push(
      `Selected: ${context.selection.title} — ${context.selection.artist} (${context.selection.type} #${context.selection.id})`
    );
  }

  if (context.errorMessage) {
    lines.push(`Error: ${context.errorMessage}`);
  }

  if (!lines.length) {
    return null;
  }

  return (
    <ContextSummaryBox>
      <ul className="list-inside list-disc space-y-1">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </ContextSummaryBox>
  );
}

function getDefaultReportKind(detail: ReportableDetailState): IssueReportKind {
  if (detail.type === "error") {
    return "load_failed";
  }

  if (detail.type === "song" || detail.type === "album") {
    return "missing_match";
  }

  return "missing_match";
}

function ContextSummaryBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-[#d8d6cf] bg-[#f5f3ee] px-3 py-2 text-sm text-[#555550]">
      {children}
    </div>
  );
}

function DialogOverlay({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-[#181916]/45">
      <button
        aria-label="Close dialog"
        className="absolute inset-0"
        type="button"
        onClick={onClose}
      />
      <div className="relative z-10 flex min-h-full items-end justify-center p-4 sm:items-center">
        {children}
      </div>
    </div>
  );
}

function DialogPanel({
  children,
  ariaLabelledBy,
  onClose,
}: {
  children: ReactNode;
  ariaLabelledBy: string;
  onClose: () => void;
}) {
  return (
    <div
      aria-labelledby={ariaLabelledBy}
      aria-modal="true"
      className="w-full max-w-md overflow-hidden rounded-lg border border-[#c8c7bf] bg-[#fbf9f4] shadow-xl"
      role="dialog"
    >
      <div className="flex items-center justify-between border-b border-[#c8c7bf] px-5 py-4">
        <h2
          className="[font-family:var(--font-newsreader)] text-2xl font-medium italic"
          id={ariaLabelledBy}
        >
          Report an issue
        </h2>
        <button
          aria-label="Close"
          className="rounded p-1 text-[#777770] transition hover:bg-[#ece9e2] hover:text-[#181916]"
          type="button"
          onClick={onClose}
        >
          <X className="size-5" />
        </button>
      </div>
      {children}
    </div>
  );
}
