"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

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

export function AnalysisPanel({
  analysis,
  paperId
}: {
  analysis: AnalysisView | null;
  paperId: string;
}) {
  const t = useTranslations("workspace");
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [failed, setFailed] = useState(false);

  async function generate() {
    if (generating) return;
    setGenerating(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/papers/${paperId}/analyze`, { method: "POST" });
      if (!res.ok) throw new Error("analysis request failed");
      // The analysis arrives as a server prop, so a refresh pulls it in.
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setGenerating(false);
    }
  }

  if (!analysis) {
    return (
      <section className="flex h-full flex-col items-center justify-center gap-3 rounded border border-border bg-white px-4 py-8 text-center text-sm text-muted">
        <p>{t("analysisEmpty")}</p>
        <button
          type="button"
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          onClick={() => void generate()}
          disabled={generating}
        >
          {generating ? t("analysisGenerating") : t("analysisGenerate")}
        </button>
        {failed ? <p className="text-xs text-red-600">{t("analysisGenerateFailed")}</p> : null}
      </section>
    );
  }

  return (
    <section className="h-full overflow-auto rounded border border-border bg-white p-4">
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
  );
}
