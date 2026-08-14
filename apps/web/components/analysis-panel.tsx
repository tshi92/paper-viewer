"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RowMenu } from "@/components/row-menu";
import { toast } from "@/components/toast";
import { endFlight, startFlight, useFlight } from "@/lib/async-flight";
import type { PdfOutlineEntry } from "@/lib/pdf-outline";

export type AnalysisView = {
  summary: string;
  motivation: string | null;
  problem: string | null;
  method: string | null;
  keyFindings: string | null;
  whyItMatters: string | null;
  keywords: string[];
  /**
   * ISO timestamp of the analysis row. Regeneration ends when a *different*
   * timestamp shows up in the server props — the analysis merely being present
   * is not enough, since one is present the whole time.
   */
  generatedAt: string;
};

/**
 * The `generatedAt` of the analysis a regeneration is replacing, keyed like the
 * flight store and module-level for the same reason: the wait must survive
 * navigating away and back. An entry here changes what "done" means for the
 * flight — a *different* timestamp in the server props, not just any analysis.
 */
const regenBaselines = new Map<string, string>();

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
  canGenerate,
  outline,
  onJumpToPage
}: {
  analysis: AnalysisView | null;
  paperId: string;
  /**
   * Whether the paper carries anything to write an intro from — an abstract, or
   * a PDF whose text can be read. A catalog entry has neither: the upstream
   * feed is titles and authors only.
   */
  canGenerate: boolean;
  /** Embedded PDF bookmarks; null while loading, [] when the PDF has none. */
  outline?: PdfOutlineEntry[] | null;
  onJumpToPage?: (page: number) => void;
}) {
  const t = useTranslations("workspace");
  const router = useRouter();
  // Generation state lives in the module-level flight store, keyed per paper:
  // it takes minutes, and the "Generating…" indicator must survive navigating
  // away and back while the server keeps working. Failures surface as sticky
  // toasts for the same reason.
  const flightKey = `analysis:${paperId}`;
  const generating = useFlight(flightKey);
  const autoFired = useRef(false);
  const outlineBlock =
    outline && outline.length > 0 && onJumpToPage ? (
      <OutlineBlock outline={outline} onJumpToPage={onJumpToPage} />
    ) : null;

  // Generation takes minutes, long enough for proxies to drop the request
  // connection while the server keeps working. So the request is not the
  // source of truth: while generating, poll the server props — the analysis
  // appearing there is what ends the wait, whatever happened to the fetch.
  useEffect(() => {
    if (!generating) return;
    // First generation is done when an analysis appears at all; a regeneration
    // only when its timestamp differs from the baseline recorded at the start.
    if (analysis && analysis.generatedAt !== regenBaselines.get(flightKey)) {
      regenBaselines.delete(flightKey);
      endFlight(flightKey);
      return;
    }
    const interval = setInterval(() => router.refresh(), 5_000);
    // Give up after the server's own time limit (300s) plus one poll.
    const deadline = setTimeout(() => {
      regenBaselines.delete(flightKey);
      endFlight(flightKey);
      toast.error(t("analysisGenerateFailed"));
    }, 305_000);
    return () => {
      clearInterval(interval);
      clearTimeout(deadline);
    };
  }, [generating, analysis, router, flightKey, t]);

  function stopWaiting(messageKey: "analysisGenerateFailed" | "analysisNoSource") {
    regenBaselines.delete(flightKey);
    endFlight(flightKey);
    toast.error(t(messageKey));
  }

  async function generate(regenerate = false) {
    if (generating) return;
    if (regenerate && analysis) regenBaselines.set(flightKey, analysis.generatedAt);
    startFlight(flightKey);
    try {
      const res = await fetch(`/api/papers/${paperId}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate })
      });
      if (!res.ok) {
        stopWaiting("analysisGenerateFailed");
        return;
      }
      // The server found nothing to work from — a PDF that yields no text, say,
      // which cannot be known before trying. Stop waiting and say why.
      const body = (await res.json().catch(() => ({}))) as { generated?: boolean };
      if (body.generated === false) {
        stopWaiting("analysisNoSource");
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

  // A library paper without an intro starts generating on open, no click
  // needed: the post-save generation can die silently when the LLM's only
  // concurrency slot is busy (digest run), and this heals it. Once per mount —
  // if it fails, the button stays for a manual retry.
  // NEXT_PUBLIC_AUTO_GENERATE_INTRO=off opts out (set in dev/E2E .env so test
  // runs and local browsing do not burn real LLM calls on fixture papers).
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_AUTO_GENERATE_INTRO === "off") return;
    if (analysis || generating || autoFired.current || !canGenerate) return;
    autoFired.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, generating]);

  if (!analysis) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        {outlineBlock}
        <section className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto rounded border border-border bg-white shadow-card p-4 text-center text-sm text-muted">
        {canGenerate ? (
          <>
            <p>{t("analysisEmpty")}</p>
            <button
              type="button"
              className="rounded border border-accent/40 px-3 py-1.5 text-sm font-medium text-accent transition-colors duration-150 hover:bg-accent/10 disabled:opacity-50"
              onClick={() => void generate()}
              disabled={generating}
            >
              {generating ? t("analysisGenerating") : t("analysisGenerate")}
            </button>
          </>
        ) : (
          // No button at all: there is nothing to press it against, and the way
          // out is to give the paper a PDF.
          <p className="max-w-xs leading-relaxed">{t("analysisNoSource")}</p>
        )}
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
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase text-muted">{t("analysisHeading")}</h2>
        {generating ? (
          <span className="text-xs text-muted">{t("analysisGenerating")}</span>
        ) : canGenerate ? (
          <RowMenu items={[{ label: t("analysisRegenerate"), onSelect: () => void generate(true) }]} />
        ) : null}
      </div>
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
      </div>
      </section>
    </div>
  );
}
