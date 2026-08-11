import Link from "next/link";
import { prisma } from "@paper-viewer/db";
import { PaperUploadForm } from "@/components/paper-upload-form";
import { RemovePaperButton } from "@/components/remove-paper-button";
import { MoreTopics } from "@/components/more-topics";
import { requireCurrentUser } from "@/lib/auth";

const TIME_FILTERS: Record<string, { label: string; days: number }> = {
  all: { label: "All", days: 0 },
  today: { label: "Today", days: 1 },
  "3d": { label: "3 days", days: 3 },
  week: { label: "This week", days: 7 },
  month: { label: "This month", days: 30 }
};

export default async function LibraryPage({
  searchParams
}: {
  searchParams: Promise<{ time?: string; tag?: string }>;
}) {
  const user = await requireCurrentUser();
  const { time = "all", tag } = await searchParams;

  const timeFilter = TIME_FILTERS[time] ?? TIME_FILTERS.all!;
  const dateFilter = timeFilter.days > 0
    ? { gte: new Date(Date.now() - timeFilter.days * 24 * 60 * 60 * 1000) }
    : undefined;

  const workspacePapers = await prisma.workspacePaper.findMany({
    where: {
      workspaceId: user.workspaceId,
      state: "visible",
      ...(dateFilter ? { createdAt: dateFilter } : {}),
      ...(tag ? { tags: { has: tag } } : {})
    },
    include: {
      paper: { include: { files: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  // Collect topics
  const [allPaperTags, prefs] = await Promise.all([
    prisma.workspacePaper.findMany({
      where: { workspaceId: user.workspaceId, state: "visible" },
      select: { tags: true }
    }),
    prisma.researchPreferences.findUnique({
      where: { workspaceId: user.workspaceId },
      select: { topics: true, keywords: true }
    })
  ]);

  const prefTopicSet = new Set([...(prefs?.topics ?? []), ...(prefs?.keywords ?? [])]);
  const paperTopics = allPaperTags.flatMap((p) => p.tags);

  // Count papers per topic
  const topicCounts = new Map<string, number>();
  for (const t of paperTopics) {
    topicCounts.set(t, (topicCounts.get(t) ?? 0) + 1);
  }

  // Split: preference topics (main) vs discovered topics (more)
  const mainTopics = [...prefTopicSet].filter((t) => topicCounts.has(t))
    .sort((a, b) => (topicCounts.get(b) ?? 0) - (topicCounts.get(a) ?? 0));
  const discoveredTopics = [...new Set(paperTopics)]
    .filter((t) => !prefTopicSet.has(t))
    .sort((a, b) => (topicCounts.get(b) ?? 0) - (topicCounts.get(a) ?? 0));

  function buildUrl(params: { time?: string | null; tag?: string | null }) {
    const p = new URLSearchParams();
    const newTime = params.time !== undefined ? params.time : time;
    const newTag = params.tag !== undefined ? params.tag : tag;
    if (newTime && newTime !== "all") p.set("time", newTime);
    if (newTag) p.set("tag", newTag);
    const qs = p.toString();
    return `/library${qs ? `?${qs}` : ""}`;
  }

  // Check if current tag is a discovered (non-pref) topic
  const isDiscoveredTag = tag && !prefTopicSet.has(tag);

  return (
    <section className="rounded border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Library</h1>
        <PaperUploadForm />
      </div>

      <div className="border-b border-border px-4 py-2 space-y-1.5">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-muted mr-1">Time:</span>
          {Object.entries(TIME_FILTERS).map(([key, { label }]) => {
            const isActive = time === key || (key === "all" && !time);
            return (
              <Link
                key={key}
                href={buildUrl({ time: key })}
                className={`rounded px-2 py-0.5 text-xs ${isActive ? "bg-accent text-white" : "text-muted hover:bg-surface"}`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {(mainTopics.length > 0 || discoveredTopics.length > 0) ? (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs font-medium text-muted mr-1">Topics:</span>
            {mainTopics.map((t) => {
              const isActive = tag === t;
              const count = topicCounts.get(t) ?? 0;
              return (
                <Link
                  key={t}
                  href={buildUrl({ tag: isActive ? null : t })}
                  className={`rounded px-2 py-0.5 text-xs ${isActive ? "bg-accent text-white" : "bg-surface text-muted hover:bg-border"}`}
                >
                  {t} ({count}){isActive ? " ×" : ""}
                </Link>
              );
            })}
            {isDiscoveredTag ? (
              <Link
                href={buildUrl({ tag: null })}
                className="rounded bg-accent px-2 py-0.5 text-xs text-white"
              >
                {tag} ({topicCounts.get(tag) ?? 0}) ×
              </Link>
            ) : null}
            {discoveredTopics.length > 0 ? (
              <MoreTopics
                topics={discoveredTopics}
                topicCounts={Object.fromEntries(topicCounts)}
                currentTag={tag}
                currentTime={time}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="px-4 py-2 text-xs text-muted">
        {workspacePapers.length} paper{workspacePapers.length !== 1 ? "s" : ""}
        {time !== "all" ? ` · ${timeFilter.label}` : ""}
        {tag ? ` · ${tag}` : ""}
      </div>

      <div className="divide-y divide-border">
        {workspacePapers.map(({ paper, tags, id: wpId }) => (
          <div className="flex items-center justify-between px-4 py-4 hover:bg-surface group" key={paper.id}>
            <Link className="min-w-0 flex-1" href={`/papers/${paper.id}`}>
              <h2 className="font-medium">{paper.title}</h2>
              <p className="mt-1 text-sm text-muted">{Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-muted">
                  {paper.source === "arxiv" || paper.source === "hermes" ? `arXiv:${paper.arxivId ?? ""}` : paper.source}
                  {/* 与论文详情页的 hasPdf 判定保持一致：Blob 快照也算有 PDF */}
                  {paper.files.length > 0 || paper.blobUrl ? " · PDF" : ""}
                </span>
                {tags.length > 0 ? (
                  <div className="flex gap-1">
                    {tags.slice(0, 3).map((t) => (
                      <span key={t} className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">{t}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </Link>
            <div className="flex items-center gap-2">
              {paper.arxivId ? (
                <a
                  href={`https://arxiv.org/abs/${paper.arxivId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded border border-border px-2.5 py-1 text-xs text-accent hover:bg-surface"
                >
                  arXiv
                </a>
              ) : null}
              <RemovePaperButton workspacePaperId={wpId} />
            </div>
          </div>
        ))}
        {workspacePapers.length === 0 ? (
          <p className="px-4 py-8 text-sm text-muted">
            No papers found{time !== "all" || tag ? " with current filters." : "."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
