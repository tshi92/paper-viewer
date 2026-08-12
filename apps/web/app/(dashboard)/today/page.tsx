import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { isReadingState } from "@paper-viewer/core/paper-status";
import { requireCurrentUser } from "@/lib/auth";
import { DiscoverButton } from "@/components/discover-button";
import { DigestProgressBanner } from "@/components/digest-progress-banner";
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

  // A run in flight: papers still pending, or a fresh pipeline lock. Derived
  // server-side so the state survives navigating away and back — the Discover
  // button's local spinner is only a courtesy. A pending digest whose lock is
  // stale means the previous serverless invocation was hard-killed mid-run;
  // the banner resumes it from the client instead of spinning forever.
  const lockFresh = digests.some(
    (digest) => digest.lockedAt !== null && Date.now() - digest.lockedAt.getTime() < 10 * 60 * 1000
  );
  // Only today's digest counts: the resume path can only advance today's run,
  // so leftovers on an older digest must not produce an unfinishable banner.
  const todayUtc = new Date().toISOString().slice(0, 10);
  const pendingDigest = digests.find(
    (digest) =>
      digest.pendingPaperIds.length > 0 && digest.date.toISOString().slice(0, 10) === todayUtc
  );

  // Today gets the full treatment; older days collapse to one row each so the
  // page stays scannable (they expand to plain title lists on demand).
  const todayDigest = digests.find(
    (digest) => digest.date.toISOString().slice(0, 10) === todayUtc
  );
  const pastDigests = digests.filter((digest) => digest !== todayDigest);
  const digestInProgress = lockFresh || Boolean(pendingDigest);
  const digestTotal = pendingDigest?.paperIds.length ?? 0;
  const digestDone = pendingDigest ? digestTotal - pendingDigest.pendingPaperIds.length : 0;

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

      {digestInProgress ? (
        <DigestProgressBanner
          done={digestDone}
          total={digestTotal}
          stalled={Boolean(pendingDigest) && !lockFresh}
        />
      ) : null}

      {digests.length === 0 ? (
        // First-run guidance instead of a blank viewport: what this page is,
        // when it fills itself, and the one thing to do next.
        <div className="flex flex-col items-center gap-3 rounded border border-border bg-white shadow-card px-6 py-16 text-center">
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

      {todayDigest ? (
        <section className="space-y-3">
          <div className="rounded border border-border bg-white shadow-card p-5">
            <h2 className="text-sm font-semibold uppercase text-muted">
              {t("digestMeta", {
                date: dateFormat.format(new Date(todayDigest.date)),
                count: todayDigest.paperIds.length
              })}
            </h2>
            {todayDigest.overviewSummary ? (
              <div className="mt-3 whitespace-pre-line text-sm leading-relaxed">
                {todayDigest.overviewSummary}
              </div>
            ) : null}
          </div>

          {todayDigest.paperIds
            .map((id) => papersById.get(id))
            .filter((paper): paper is NonNullable<typeof paper> => Boolean(paper))
            .map((paper, index, digestPapers) => {
              const analysis = paper.analyses[0];
              const workspacePaper = paper.workspacePapers[0];
              const readingState = workspacePaper?.readingStates[0]?.state ?? "new";

              return (
                <div
                  key={paper.id}
                  className="rounded border border-border bg-white shadow-card p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-raised"
                >
                  <div className="flex items-start justify-between gap-4">
                    {/* Only the content column links out, so the actions on the
                        right stay clickable without nesting buttons in an <a>.
                        Cards are deliberately slim — a two-line summary and the
                        keywords; the full analysis lives on the paper page. */}
                    <Link href={`/papers/${paper.id}?from=today`} className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-accent">
                          {index + 1}/{digestPapers.length}
                        </span>
                        <h3 className="font-semibold">{paper.title}</h3>
                      </div>
                      <p className="mt-1 line-clamp-1 text-sm text-muted">
                        {Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}
                      </p>
                      {analysis ? (
                        <div className="mt-2 space-y-2 text-sm">
                          <p className="line-clamp-2">{analysis.summary}</p>
                          {analysis.keywords.length > 0 ? (
                            <div className="flex flex-wrap gap-1.5">
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
                        <a
                          href={`https://arxiv.org/abs/${paper.arxivId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-muted hover:text-accent hover:underline"
                        >
                          arXiv:{paper.arxivId} ↗
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
        </section>
      ) : null}

      {pastDigests.map((digest, digestIndex) => {
        const digestPapers = digest.paperIds
          .map((id) => papersById.get(id))
          .filter((paper): paper is NonNullable<typeof paper> => Boolean(paper));

        return (
          // Native disclosure keeps this a server component; with no digest for
          // today the most recent day starts open so the page is never bare.
          <details
            key={digest.id}
            open={!todayDigest && digestIndex === 0}
            className="group rounded border border-border bg-white shadow-card"
          >
            <summary className="flex cursor-pointer select-none items-center gap-2 px-5 py-3 text-sm font-semibold uppercase text-muted list-none [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="text-xs transition-transform duration-150 group-open:rotate-90">
                ▸
              </span>
              {t("digestMeta", {
                date: dateFormat.format(new Date(digest.date)),
                count: digestPapers.length
              })}
            </summary>
            <div className="border-t border-border">
              {digestPapers.map((paper) => {
                const workspacePaper = paper.workspacePapers[0];
                return (
                  <div
                    key={`${digest.id}-${paper.id}`}
                    className="flex items-center justify-between gap-3 border-t border-t-border px-5 py-2 first:border-t-0"
                  >
                    <Link
                      href={`/papers/${paper.id}?from=today`}
                      className="min-w-0 flex-1 truncate text-sm hover:text-accent"
                    >
                      {paper.title}
                    </Link>
                    {workspacePaper ? (
                      <span className="shrink-0 rounded bg-surface px-2 py-0.5 text-xs text-muted">
                        {t("savedBadge")}
                      </span>
                    ) : (
                      <SaveToLibraryButton paperId={paper.id} />
                    )}
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}
