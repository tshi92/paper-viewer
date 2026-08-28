import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { pickLeadDigest, summaryLineOf } from "@/lib/daily-digest";
import { requireCurrentUser } from "@/lib/auth";
import { DiscoverButton } from "@/components/discover-button";
import { DigestProgressBanner } from "@/components/digest-progress-banner";
import { InLibraryLink } from "@/components/in-library-link";
import { MarkdownBody } from "@/components/markdown-body";
import { SaveToLibraryButton } from "@/components/save-to-library-button";
import { TopicChip } from "@/components/topic-chip";

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
          // Present only while a *visible* library row exists. Removing a
          // paper archives its row instead of deleting it, so matching on "a
          // row exists" showed an archived paper as saved here while the
          // library itself no longer listed it — and the save action that
          // would bring it back was hidden behind that wrong state.
          workspacePapers: {
            where: { workspaceId: user.workspaceId, state: "visible" },
            select: { id: true }
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

  // The lead digest gets the full treatment — the dated card with the briefing
  // — and older days collapse to one row each so the page stays scannable
  // (they expand to plain title lists on demand).
  //
  // It falls back to the most recent day rather than going blank, because
  // "today's digest" does not exist for most of the morning: the date key rolls
  // over at 00:00 UTC (08:00 Beijing) while the run happens at the workspace's
  // push hour, 13:00 by default. Without the fallback the page would spend
  // those hours showing a list of yesterday's titles and no briefing at all,
  // and the briefing is the thing the day is read through. The card is labelled
  // with the digest's own date either way, so a stale one never poses as today.
  const leadDigest = pickLeadDigest(digests, todayUtc);
  const leadIsToday = leadDigest?.date.toISOString().slice(0, 10) === todayUtc;
  const pastDigests = digests.filter((digest) => digest !== leadDigest);
  const digestInProgress = lockFresh || Boolean(pendingDigest);
  const digestTotal = pendingDigest?.paperIds.length ?? 0;
  const digestDone = pendingDigest ? digestTotal - pendingDigest.pendingPaperIds.length : 0;

  const leadDigestPapers = (leadDigest?.paperIds ?? [])
    .map((id) => papersById.get(id))
    .filter((paper): paper is NonNullable<typeof paper> => Boolean(paper));
  const savedCount = leadDigestPapers.filter((paper) => paper.workspacePapers.length > 0).length;

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
          <Link href="/settings/preferences" className="rounded border border-accent/40 px-3 py-2 text-sm font-medium text-accent transition-colors duration-150 hover:bg-accent/10">
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

      {leadDigest ? (
        /* The briefing leads and takes the wide column: it is what the day is
           read through, and the papers are what it points at. The list is the
           narrower, quieter column — a title and its authors, enough to decide
           whether to open one; the summary and topics wait on the paper page.
           Below `lg` the two stack, briefing first. */
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          {/* `lg:flex-1`, not `flex-1`: while the two are stacked the container
              is a column, where flex-basis:0 would collapse this card's height
              to nothing. */}
          <section className="w-full min-w-0 lg:flex-1">
            <div className="rounded bg-white shadow-card">
              <div className="border-b border-border px-5 py-4">
                {/* Named for what it is, not for where it sits: between the
                    date rolling over and the day's run, this card is holding
                    the previous edition, and calling that "today's" would be a
                    lie the date underneath immediately contradicts. */}
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                  {leadIsToday ? t("overviewTitle") : t("latestBriefing")}
                </p>
                {/* The date at full size: this page is one day's edition, and
                    which day it is should not have to be inferred. */}
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">
                  {dateFormat.format(new Date(leadDigest.date))}
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {t("digestCount", { count: leadDigestPapers.length })}
                  {savedCount > 0 ? ` · ${t("savedCount", { count: savedCount })}` : ""}
                </p>
              </div>
              {leadDigest.overviewSummary ? (
                // The model writes the briefing in markdown — headings for each
                // trend, lists for the papers worth reading — and rendering it
                // as plain text left the asterisks and hyphens on screen.
                <div className="px-5 py-4">
                  <MarkdownBody className="text-[15px] leading-[1.9]">
                    {leadDigest.overviewSummary}
                  </MarkdownBody>
                </div>
              ) : null}
            </div>
          </section>

          {/* Sticky: the list is the shorter column, so it stays in reach while
              the briefing scrolls. */}
          <aside className="w-full lg:sticky lg:top-16 lg:w-[22rem] lg:shrink-0">
            <div className="divide-y divide-border rounded bg-white shadow-card lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
              {leadDigestPapers.map((paper, index) => {
                const summaryLine = summaryLineOf(paper.analyses[0]?.summary);
                const workspacePaper = paper.workspacePapers[0];

                return (
                  <div key={paper.id} className="px-4 py-3 transition-colors duration-150 hover:bg-surface">
                    <div className="flex items-start gap-2.5">
                      <span
                        aria-hidden
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-surface text-[11px] font-semibold text-muted"
                      >
                        {index + 1}
                      </span>
                      {/* Only the content column links out, so the actions below
                          stay clickable without nesting buttons in an <a>. */}
                      <Link href={`/papers/${paper.id}?from=today`} className="min-w-0 flex-1">
                        <h3 className="text-sm font-medium leading-snug">{paper.title}</h3>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                          {Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}
                        </p>
                        {/* One sentence, the same one the Feishu card carries:
                            enough to tell whether this is the paper you want
                            without turning the column back into a wall of
                            summaries. */}
                        {summaryLine ? (
                          <p className="mt-1 line-clamp-2 text-xs leading-relaxed">{summaryLine}</p>
                        ) : null}
                      </Link>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-end gap-2 pl-7">
                      {paper.arxivId ? (
                        <a
                          href={`https://arxiv.org/abs/${paper.arxivId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mr-auto text-[11px] text-muted hover:text-accent hover:underline"
                        >
                          arXiv:{paper.arxivId}
                        </a>
                      ) : null}
                      {/* Reading state is a per-reader control and lives on the
                          paper page. This column is read to decide what to open
                          next, and a row of four chips under every saved paper
                          made a scan list look like a form. */}
                      {workspacePaper ? (
                        <InLibraryLink paperId={paper.id} />
                      ) : (
                        <SaveToLibraryButton paperId={paper.id} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </aside>
        </div>
      ) : null}

      {pastDigests.map((digest, digestIndex) => {
        const digestPapers = digest.paperIds
          .map((id) => papersById.get(id))
          .filter((paper): paper is NonNullable<typeof paper> => Boolean(paper));

        return (
          // Native disclosure keeps this a server component. These all start
          // closed: the most recent day used to be forced open so a page with
          // no digest for today was not bare, and that job now belongs to the
          // lead card, which shows that same day in full rather than as a list
          // of titles.
          <details
            key={digest.id}
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
                      <InLibraryLink paperId={paper.id} className="shrink-0" />
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
