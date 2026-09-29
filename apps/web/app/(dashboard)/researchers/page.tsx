import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";
import { ResearcherSyncButton } from "@/components/researcher-sync-button";
import { loadWindowPapers, type DigestContent } from "@/lib/researcher-digest";
import { isoDay, monthKey, newSince, utcDay, windowStart } from "@/lib/researchers";
import { HotTopicsCard } from "./hot-topics-card";
import { ResearchersView } from "./researchers-view";

/**
 * Tracked researchers' last three months on arXiv under this workspace's
 * directions, with its monthly hot-topics issue on top.
 */
export default async function ResearchersPage() {
  const user = await requireCurrentUser();
  const t = await getTranslations("researchers");
  const locale = await getLocale();
  const now = new Date();

  const [researchers, papers, issue] = await Promise.all([
    prisma.researcher.findMany({
      where: { active: true },
      select: { slug: true, name: true, affiliation: true, knownFor: true }
    }),
    loadWindowPapers(user.workspaceId, now),
    prisma.researcherDigest.findFirst({ where: { workspaceId: user.workspaceId }, orderBy: { month: "desc" } })
  ]);
  const saved = await prisma.workspacePaper.findMany({
    where: { workspaceId: user.workspaceId, state: "visible", paperId: { in: papers.map((p) => p.id) } },
    select: { paperId: true }
  });
  const inLibrary = new Set(saved.map((row) => row.paperId));
  const since = isoDay(newSince(now));
  const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <div className="space-y-5">
      <section className="grid gap-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          {canManageWorkspaceSettings(user.role) ? <ResearcherSyncButton /> : null}
        </div>
        <p className="text-[15px]">{t("lede", { count: researchers.length })}</p>
        <p className="text-[13px] tabular-nums text-muted">
          {t("meta", { from: day.format(windowStart(now)), to: day.format(utcDay(now)), papers: papers.length })} ·{" "}
          <span className="font-medium text-accent">{t("fresh", { count: papers.filter((p) => p.published >= since).length })}</span>
        </p>
      </section>
      <HotTopicsCard
        issue={issue ? { month: issue.month, content: issue.content as unknown as DigestContent } : null}
        isCurrent={issue !== null && issue.month.getTime() === monthKey(now).getTime()}
      />
      <ResearchersView
        researchers={researchers}
        papers={papers.map((p) => ({
          id: p.id, arxivId: p.arxivId, title: p.title, abstract: p.abstract, authors: p.authors,
          published: p.published, directionId: p.directionId,
          researchers: p.researchers.map(({ slug, position }) => ({ slug, position })),
          inLibrary: inLibrary.has(p.id)
        }))}
        windowFrom={isoDay(windowStart(now))}
        windowTo={isoDay(utcDay(now))}
        newSince={since}
      />
    </div>
  );
}
