import { getTranslations } from "next-intl/server";
import { BackButton } from "./back-button";
import { SaveToLibraryButton } from "./save-to-library-button";
import { ScholarIcon } from "./scholar-icon";
import { TopicChip } from "./topic-chip";
import type { AnalysisView } from "./analysis-panel";

/**
 * Read-only view of a paper that has not been saved to the library yet
 * (surfaced by a digest or the conference catalog). No annotations, comments
 * or reading state — the PDF renders in the browser's own viewer via an
 * iframe, and the only action is "save to library". Catalog entries often
 * arrive as bare metadata (no PDF, no abstract), so the layout must carry a
 * link-out (publisher page, Scholar search) instead of a wall of empty boxes.
 */
export async function PaperPreview({
  paper,
  fromDigest
}: {
  /** Whether the paper reached this workspace through a daily digest. */
  fromDigest: boolean;
  paper: {
    id: string;
    title: string;
    authors: string[];
    arxivId: string | null;
    pdfUrl: string | null;
    externalUrl: string | null;
    doi: string | null;
    abstract: string | null;
    hasPdf: boolean;
    /** Whether anything exists to write an intro from — an abstract or a readable PDF. */
    canGenerateIntro: boolean;
    /** The inline PDF is an arXiv preprint while the version of record is the conference's. */
    pdfIsPreprint: boolean;
    analysis: AnalysisView | null;
    conference: { venue: string; year: number } | null;
  };
}) {
  const t = await getTranslations("preview");
  const tWorkspace = await getTranslations("workspace");
  const tCommon = await getTranslations("common");

  const pdfUrl = paper.hasPdf
    ? `/api/papers/${paper.id}/file`
    : paper.arxivId
      ? `/api/papers/${paper.id}/arxiv-pdf`
      : paper.pdfUrl
        ? `/api/papers/${paper.id}/proxy-pdf`
        : null;

  const scholarUrl = `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`;
  const externalUrl = paper.externalUrl ?? (paper.doi ? `https://doi.org/${paper.doi}` : null);

  const sections = [
    { body: paper.analysis?.motivation, labelKey: "analysisMotivation" as const },
    { body: paper.analysis?.problem, labelKey: "analysisProblem" as const },
    { body: paper.analysis?.method, labelKey: "analysisMethod" as const },
    { body: paper.analysis?.keyFindings, labelKey: "analysisFindings" as const },
    { body: paper.analysis?.whyItMatters, labelKey: "analysisWhyItMatters" as const }
  ];

  return (
    <div className="space-y-3">
      {/* Standalone back affordance at the page's top-left, outside the
          title card — it navigates the app, not the paper. */}
      <BackButton fallbackHref={paper.conference ? "/conferences" : "/today"} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        <div className="mb-3 rounded border border-border bg-white shadow-card px-4 py-3">
          <h1 className="text-lg font-semibold leading-snug">{paper.title}</h1>
          <p className="mt-1 text-xs text-muted">
            {paper.authors.join(", ")}
            {paper.conference ? ` · ${paper.conference.venue} ${paper.conference.year}` : ""}
          </p>
          {/* The links get their own line. A long author list would otherwise
              wrap them one at a time, leaving a lone icon on a line of its own. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {paper.arxivId ? (
              <a
                href={`https://arxiv.org/abs/${paper.arxivId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap text-accent hover:underline"
              >
                arXiv:{paper.arxivId}
              </a>
            ) : null}
            {externalUrl ? (
              <a
                href={externalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="whitespace-nowrap text-accent hover:underline"
              >
                {tCommon("sourceLink")}
              </a>
            ) : null}
            {/* Always, alongside whatever else is known: Scholar answers a
                different question — what else is out there, who cites it, is
                there another version — and until now it only appeared as a
                stand-in for a missing publisher link. */}
            <a
              href={scholarUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("searchScholar")}
              title={t("searchScholar")}
              className="inline-flex items-center"
            >
              <ScholarIcon />
            </a>
          </div>
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
        ) : paper.abstract ? (
          <div className="rounded border border-border bg-white shadow-card p-6 text-sm text-muted">
            <div className="max-w-2xl">
              <h2 className="font-semibold text-ink">{tWorkspace("abstractHeading")}</h2>
              <p className="mt-2 leading-relaxed">{paper.abstract}</p>
            </div>
          </div>
        ) : (
          // No PDF and no abstract: a slim pointer out instead of an empty box.
          <p className="rounded border border-border bg-surface px-4 py-3 text-sm text-muted">
            {t("noPdf")}{" "}
            <a
              href={externalUrl ?? scholarUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              {externalUrl ? tCommon("sourceLink") : t("searchScholar")}
            </a>
          </p>
        )}
      </section>

      <aside className="min-w-0 lg:sticky lg:top-6 lg:self-start">
        <section className="max-h-[calc(100vh-3rem)] overflow-auto rounded border border-border bg-white shadow-card p-4">
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
                    <TopicChip key={keyword} topic={keyword} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            // Two different lifecycle notes, not a defect either way. A digest
            // paper's intro is written during the nightly run, so if it is
            // missing the run failed on it — telling that reader to "save it
            // first" would be wrong. A catalog paper genuinely has none until
            // someone saves it.
            <p className="mt-3 text-sm leading-relaxed text-muted">
              {!paper.canGenerateIntro
                ? t("introNoSource")
                : fromDigest
                  ? t("introDigestMissing")
                  : t("introAfterSave")}
            </p>
          )}
        </section>
      </aside>
      </div>
    </div>
  );
}
