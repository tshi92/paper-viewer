"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { PdfOutlineEntry } from "@/lib/pdf-outline";

export type AnalysisView = {
  summary: string;
  motivation: string | null;
  problem: string | null;
  method: string | null;
  keyFindings: string | null;
  whyItMatters: string | null;
  keywords: string[];
};

/** The five structured sections, in the order the prompt produces them. */
const SECTIONS = [
  { field: "motivation", labelKey: "analysisMotivation" },
  { field: "problem", labelKey: "analysisProblem" },
  { field: "method", labelKey: "analysisMethod" },
  { field: "keyFindings", labelKey: "analysisFindings" },
  { field: "whyItMatters", labelKey: "analysisWhyItMatters" }
] as const;

/**
 * The document's embedded table of contents, collapsible above the intro.
 * Clicking a heading jumps the PDF beside the panel to that page.
 */
function OutlineBlock({
  outline,
  onJumpToPage
}: {
  outline: PdfOutlineEntry[];
  onJumpToPage: (page: number) => void;
}) {
  const t = useTranslations("workspace");
  const [open, setOpen] = useState(true);

  return (
    <section
      className={`flex min-h-0 shrink-0 flex-col rounded border border-border bg-white shadow-card p-4 ${
        open ? "max-h-[45%]" : ""
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full shrink-0 items-center justify-between text-sm font-semibold uppercase text-muted transition-colors duration-150 hover:text-ink"
        onClick={() => setOpen((current) => !current)}
      >
        {t("outlineHeading")}
        <span aria-hidden className={`transition-transform duration-200 ${open ? "rotate-90" : ""}`}>
          ›
        </span>
      </button>
      {open ? (
        <nav className="mt-2 min-h-0 space-y-0.5 overflow-auto">
          {outline.map((entry, index) => (
            <button
              key={`${entry.page}-${index}`}
              type="button"
              className={`flex w-full items-baseline justify-between gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors duration-150 hover:bg-surface ${
                entry.level > 0 ? "pl-5 text-muted" : ""
              }`}
              onClick={() => onJumpToPage(entry.page)}
            >
              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted">{entry.page}</span>
            </button>
          ))}
        </nav>
      ) : null}
    </section>
  );
}

export function AnalysisPanel({
  analysis,
  paperId,
  outline,
  onJumpToPage
}: {
  analysis: AnalysisView | null;
  paperId: string;
  /** Embedded PDF bookmarks; null while loading, [] when the PDF has none. */
  outline?: PdfOutlineEntry[] | null;
  onJumpToPage?: (page: number) => void;
}) {
  const t = useTranslations("workspace");
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);
  const outlineBlock =
    outline && outline.length > 0 && onJumpToPage ? (
      <OutlineBlock outline={outline} onJumpToPage={onJumpToPage} />
    ) : null;

  // Generation takes minutes, long enough for proxies to drop the request
  // connection while the server keeps working. So the request is not the
  // source of truth: while generating, poll the server props — the analysis
  // appearing there is what ends the wait, whatever happened to the fetch.
  useEffect(() => {
    if (!generating || analysis) return;
    const interval = setInterval(() => router.refresh(), 5_000);
    // Give up after the server's own time limit (300s) plus one poll.
    const deadline = setTimeout(() => {
      setGenerating(false);
      setFailed(true);
    }, 305_000);
    return () => {
      clearInterval(interval);
      clearTimeout(deadline);
    };
  }, [generating, analysis, router]);

  async function generate() {
    if (generating) return;
    setGenerating(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/papers/${paperId}/analyze`, { method: "POST" });
      if (!res.ok) {
        setGenerating(false);
        setFailed(true);
        return;
      }
      // Pull the fresh server props in right away; the polling effect stays on
      // as the backstop until the analysis actually shows up in them.
      router.refresh();
    } catch {
      // Connection dropped — the server is likely still generating. Leave the
      // polling effect running; it either finds the analysis or times out.
    }
  }

  if (!analysis) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {outlineBlock}
        <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto rounded border border-border bg-white shadow-card p-4 text-center text-sm text-muted">
        <p>{t("analysisEmpty")}</p>
        <button
          type="button"
          className="rounded bg-accent transition-transform duration-150 active:scale-[0.98] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void generate()}
          disabled={generating}
        >
          {generating ? t("analysisGenerating") : t("analysisGenerate")}
        </button>
        {failed ? <p role="alert" className="text-xs text-danger">{t("analysisGenerateFailed")}</p> : null}
        </section>
      </div>
    );
  }

  return (
    // Contents and Intro are two separate cards, each with its own scroll:
    // a long outline must not push the intro out of reach, and vice versa.
    <div className="flex h-full min-h-0 flex-col gap-3">
      {outlineBlock}
      <section className="min-h-0 flex-1 overflow-auto rounded border border-border bg-white shadow-card p-4">
      <h2 className="text-sm font-semibold uppercase text-muted">{t("analysisHeading")}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed">
        <p>{analysis.summary}</p>
        {SECTIONS.map(({ field, labelKey }) => {
          const body = analysis[field];
          if (!body) return null;
          return (
            <div key={field}>
              <div className="font-medium">{t(labelKey)}</div>
              <p className="mt-0.5 whitespace-pre-wrap">{body}</p>
            </div>
          );
        })}
        {analysis.keywords.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {analysis.keywords.map((keyword) => (
              <span key={keyword} className="rounded bg-surface px-2 py-0.5 text-xs text-muted">
                {keyword}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      </section>
    </div>
  );
}
