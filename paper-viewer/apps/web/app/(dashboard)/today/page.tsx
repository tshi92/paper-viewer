import Link from "next/link";
import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";
import { DiscoverButton } from "@/components/discover-button";

export default async function TodayPage() {
  const user = await requireCurrentUser();

  // Find the most recent digest
  const digest = await prisma.dailyDigest.findFirst({
    where: { workspaceId: user.workspaceId },
    orderBy: { date: "desc" }
  });

  // Get today's papers (from digest or recent hermes imports)
  const papers = digest
    ? await prisma.paper.findMany({
        where: { id: { in: digest.paperIds } },
        include: {
          analyses: {
            where: { workspaceId: user.workspaceId },
            orderBy: { createdAt: "desc" },
            take: 1
          },
          workspacePapers: {
            where: { workspaceId: user.workspaceId },
            include: {
              readingStates: {
                where: { userId: user.id }
              }
            }
          }
        }
      })
    : [];

  // Sort papers to match digest order
  const sortedPapers = digest
    ? digest.paperIds
        .map((id) => papers.find((p) => p.id === id))
        .filter(Boolean)
    : papers;

  const digestDate = digest
    ? new Date(digest.date).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })
    : null;

  const prefs = await prisma.researchPreferences.findUnique({
    where: { workspaceId: user.workspaceId }
  });
  const hasPrefs = prefs && (prefs.topics.length > 0 || prefs.keywords.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Today</h1>
          {digestDate ? (
            <p className="mt-1 text-sm text-muted">{digestDate} · {sortedPapers.length} papers</p>
          ) : (
            <p className="mt-1 text-sm text-muted">
              {hasPrefs
                ? "No papers yet. Click Discover to fetch today's recommendations."
                : "Set up your research preferences first, then discover papers."}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link href="/settings/preferences" className="rounded border border-border px-3 py-2 text-sm">
            Preferences
          </Link>
          <DiscoverButton />
        </div>
      </div>

      {digest ? (
        <div className="rounded border border-border bg-white p-5">
          <h2 className="text-sm font-semibold uppercase text-muted">Daily Overview</h2>
          <div className="mt-3 whitespace-pre-line text-sm leading-relaxed">{digest.overviewSummary}</div>
        </div>
      ) : null}

      <div className="space-y-3">
        {sortedPapers.map((paper, index) => {
          if (!paper) return null;
          const analysis = paper.analyses[0];
          const wp = paper.workspacePapers[0];
          const readingState = wp?.readingStates[0]?.state ?? "new";

          return (
            <Link
              key={paper.id}
              href={`/papers/${paper.id}`}
              className="block rounded border border-border bg-white p-5 transition hover:border-accent/40"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-accent">{index + 1}/{sortedPapers.length}</span>
                    <h2 className="font-semibold">{paper.title}</h2>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}
                  </p>
                  {analysis ? (
                    <div className="mt-3 space-y-2 text-sm">
                      <p>{analysis.summary}</p>
                      {analysis.problem ? (
                        <p className="text-muted"><span className="font-medium text-ink">Problem:</span> {analysis.problem}</p>
                      ) : null}
                      {analysis.method ? (
                        <p className="text-muted"><span className="font-medium text-ink">Method:</span> {analysis.method}</p>
                      ) : null}
                      {analysis.keyFindings ? (
                        <p className="text-muted"><span className="font-medium text-ink">Results:</span> {analysis.keyFindings}</p>
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
                </div>
                <div className="flex flex-col items-end gap-2">
                  <span className={`rounded px-2 py-0.5 text-xs ${readingState === "new" ? "bg-accent/10 text-accent" : "bg-surface text-muted"}`}>
                    {readingState}
                  </span>
                  {paper.arxivId ? (
                    <span className="text-xs text-muted">arXiv:{paper.arxivId}</span>
                  ) : null}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
