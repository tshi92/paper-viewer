import { getTranslations } from "next-intl/server";
import { SaveToLibraryButton } from "./save-to-library-button";
import type { AnalysisView } from "./analysis-panel";

/**
 * Read-only view of a paper that has not been saved to the library yet
 * (surfaced by a digest, later also by the conference feed). No annotations,
 * comments or reading state — the PDF renders in the browser's own viewer via
 * an iframe, and the only action is "save to library".
 */
export async function PaperPreview({
  paper
}: {
  paper: {
    id: string;
    title: string;
    authors: string[];
    arxivId: string | null;
    pdfUrl: string | null;
    abstract: string | null;
    hasPdf: boolean;
    analysis: AnalysisView | null;
  };
}) {
  const t = await getTranslations("preview");
  const tWorkspace = await getTranslations("workspace");

  const pdfUrl = paper.hasPdf
    ? `/api/papers/${paper.id}/file`
    : paper.arxivId
      ? `/api/papers/${paper.id}/arxiv-pdf`
      : paper.pdfUrl
        ? `/api/papers/${paper.id}/proxy-pdf`
        : null;

  const sections = [
    { body: paper.analysis?.motivation, labelKey: "analysisMotivation" as const },
    { body: paper.analysis?.problem, labelKey: "analysisProblem" as const },
    { body: paper.analysis?.method, labelKey: "analysisMethod" as const },
    { body: paper.analysis?.keyFindings, labelKey: "analysisFindings" as const },
    { body: paper.analysis?.whyItMatters, labelKey: "analysisWhyItMatters" as const }
  ];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <div className="mb-3 rounded border border-border bg-white px-4 py-3">
          <h1 className="text-lg font-semibold leading-snug">{paper.title}</h1>
          <p className="mt-1 text-xs text-muted">
            {paper.authors.join(", ")}
            {paper.arxivId ? (
              <>
                {" · "}
                <a
                  href={`https://arxiv.org/abs/${paper.arxivId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="whitespace-nowrap text-accent hover:underline"
                >
                  arXiv:{paper.arxivId} ↗
                </a>
              </>
            ) : null}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <SaveToLibraryButton paperId={paper.id} />
            <span className="text-xs text-muted">{t("readOnlyNotice")}</span>
          </div>
        </div>

        {pdfUrl ? (
          <iframe
            src={pdfUrl}
            title={paper.title}
            className="h-[calc(100vh-3rem)] w-full rounded border border-border bg-surface"
          />
        ) : (
          <div className="flex items-center justify-center rounded border border-border bg-white p-12 text-sm text-muted">
            {paper.abstract ? (
              <div className="max-w-2xl">
                <h2 className="font-semibold text-ink">{tWorkspace("abstractHeading")}</h2>
                <p className="mt-2 leading-relaxed">{paper.abstract}</p>
              </div>
            ) : (
              <p>{t("noPdf")}</p>
            )}
          </div>
        )}
      </section>

      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <section className="max-h-[calc(100vh-3rem)] overflow-auto rounded border border-border bg-white p-4">
          <h2 className="text-sm font-semibold uppercase text-muted">
            {tWorkspace("analysisHeading")}
          </h2>
          {paper.analysis ? (
            <div className="mt-3 space-y-3 text-sm leading-relaxed">
              <p>{paper.analysis.summary}</p>
              {sections.map(({ body, labelKey }) =>
                body ? (
                  <div key={labelKey}>
                    <div className="font-medium">{tWorkspace(labelKey)}</div>
                    <p className="mt-0.5 whitespace-pre-wrap">{body}</p>
                  </div>
                ) : null
              )}
              {paper.analysis.keywords.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {paper.analysis.keywords.map((keyword) => (
                    <span key={keyword} className="rounded bg-surface px-2 py-0.5 text-xs text-muted">
                      {keyword}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted">{tWorkspace("analysisEmpty")}</p>
          )}
        </section>
      </aside>
    </div>
  );
}
