import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { isReadingState } from "@paper-viewer/core/paper-status";
import { requireCurrentUser } from "@/lib/auth";
import { DiscoverButton } from "@/components/discover-button";
import { ReadingStateChips } from "@/components/reading-state-chips";
import { SaveToLibraryButton } from "@/components/save-to-library-button";

const HISTORY_DAYS = 7;

export default async function TodayPage() {
  const user = await requireCurrentUser();
  const t = await getTranslations("home");
  const locale = await getLocale();

  // The last week of digests, newest first: a missed day stays visible (and
  // its papers saveable) instead of vanishing at midnight.
  const digests = await prisma.dailyDigest.findMany({
    where: {
      workspaceId: user.workspaceId,
      date: { gte: new Date(Date.now() - HISTORY_DAYS * 86_400_000) }
    },
    orderBy: { date: "desc" }
  });

  const allPaperIds = [...new Set(digests.flatMap((digest) => digest.paperIds))];
  const papers = allPaperIds.length
    ? await prisma.paper.findMany({
        where: { id: { in: allPaperIds } },
        include: {
          analyses: {
            where: { workspaceId: user.workspaceId },
            orderBy: { createdAt: "desc" },
            take: 1
          },
          // Present only once someone saved the paper to the library.
          workspacePapers: {
            where: { workspaceId: user.workspaceId },
            include: { readingStates: { where: { userId: user.id } } }
          }
        }
      })
    : [];
  const papersById = new Map(papers.map((paper) => [paper.id, paper]));

  const dateFormat = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  });

  const prefs = await prisma.researchPreferences.findUnique({
    where: { workspaceId: user.workspaceId }
  });
  const hasPrefs = prefs && (prefs.topics.length > 0 || prefs.keywords.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <div className="flex gap-2">
          <Link href="/settings/preferences" className="rounded border border-border px-3 py-2 text-sm">
            {t("preferencesLink")}
          </Link>
          <DiscoverButton />
        </div>
      </div>

      {digests.length === 0 ? (
        // First-run guidance instead of a blank viewport: what this page is,
        // when it fills itself, and the one thing to do next.
        <div className="flex flex-col items-center gap-3 rounded border border-border bg-white px-6 py-16 text-center">
          <h2 className="text-lg font-semibold">{t("emptyGuideTitle")}</h2>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            {hasPrefs ? t("emptyGuideBodyReady") : t("emptyGuideBody")}
          </p>
          {!hasPrefs ? (
            <Link
              href="/settings/preferences"
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-white"
            >
              {t("emptyGuideCta")}
            </Link>
          ) : null}
        </div>
      ) : null}

      {digests.map((digest) => {
        const digestPapers = digest.paperIds
          .map((id) => papersById.get(id))
          .filter((paper): paper is NonNullable<typeof paper> => Boolean(paper));

        return (
          <section key={digest.id} className="space-y-3">
            <div className="rounded border border-border bg-white p-5">
              <h2 className="text-sm font-semibold uppercase text-muted">
                {t("digestMeta", {
                  date: dateFormat.format(new Date(digest.date)),
                  count: digestPapers.length
                })}
              </h2>
              {digest.overviewSummary ? (
                <div className="mt-3 whitespace-pre-line text-sm leading-relaxed">
                  {digest.overviewSummary}
                </div>
              ) : null}
            </div>

            {digestPapers.map((paper, index) => {
              const analysis = paper.analyses[0];
              const workspacePaper = paper.workspacePapers[0];
              const readingState = workspacePaper?.readingStates[0]?.state ?? "new";

              return (
                <div
                  key={`${digest.id}-${paper.id}`}
                  className="rounded border border-border bg-white p-5 transition hover:border-accent/40"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Only the content column links out, so the actions on the
                        right stay clickable without nesting buttons in an <a>. */}
                    <Link href={`/papers/${paper.id}`} className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-accent">
                          {index + 1}/{digestPapers.length}
                        </span>
                        <h3 className="font-semibold">{paper.title}</h3>
                      </div>
                      <p className="mt-1 text-sm text-muted">
                        {Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}
                      </p>
                      {analysis ? (
                        // Clamped so one wordy analysis can't take over the day's
                        // list; the paper page carries the full text.
                        <div className="mt-3 space-y-2 text-sm">
                          <p className="line-clamp-3">{analysis.summary}</p>
                          {analysis.problem ? (
                            <p className="line-clamp-2 text-muted"><span className="font-medium text-ink">{t("analysisProblem")}</span> {analysis.problem}</p>
                          ) : null}
                          {analysis.method ? (
                            <p className="line-clamp-2 text-muted"><span className="font-medium text-ink">{t("analysisMethod")}</span> {analysis.method}</p>
                          ) : null}
                          {analysis.keyFindings ? (
                            <p className="line-clamp-2 text-muted"><span className="font-medium text-ink">{t("analysisResults")}</span> {analysis.keyFindings}</p>
                          ) : null}
                          {analysis.keywords.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5 pt-1">
                              {analysis.keywords.map((kw) => (
                                <span key={kw} className="rounded bg-surface px-2 py-0.5 text-xs text-muted">{kw}</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </Link>
                    <div className="flex flex-col items-end gap-2">
                      {workspacePaper ? (
                        <>
                          <span className="rounded bg-surface px-2 py-0.5 text-xs text-muted">
                            {t("savedBadge")}
                          </span>
                          <ReadingStateChips
                            paperId={paper.id}
                            state={isReadingState(readingState) ? readingState : "new"}
                          />
                        </>
                      ) : (
                        <SaveToLibraryButton paperId={paper.id} />
                      )}
                      {paper.arxivId ? (
                        <span className="text-xs text-muted">arXiv:{paper.arxivId}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
