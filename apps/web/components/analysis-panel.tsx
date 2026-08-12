"use client";

import { useTranslations } from "next-intl";

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

export function AnalysisPanel({ analysis }: { analysis: AnalysisView | null }) {
  const t = useTranslations("workspace");

  if (!analysis) {
    return (
      <section className="flex h-full items-center justify-center rounded border border-border bg-white px-4 py-8 text-center text-sm text-muted">
        {t("analysisEmpty")}
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
