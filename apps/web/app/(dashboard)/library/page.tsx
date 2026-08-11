import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { PaperUploadForm } from "@/components/paper-upload-form";
import { RemovePaperButton } from "@/components/remove-paper-button";
import { MoreTopics } from "@/components/more-topics";
import { LibrarySearch } from "@/components/library-search";
import { requireCurrentUser } from "@/lib/auth";

/** Filter keys map to a translation key plus the window they select. */
const TIME_FILTERS: Record<string, { labelKey: string; days: number }> = {
  all: { labelKey: "timeAll", days: 0 },
  today: { labelKey: "timeToday", days: 1 },
  "3d": { labelKey: "time3d", days: 3 },
  week: { labelKey: "timeWeek", days: 7 },
  month: { labelKey: "timeMonth", days: 30 }
};

/** Only the free-form sources we know about get a translated label. */
const SOURCE_LABEL_KEYS: Record<string, string> = {
  manual: "sourceManual"
};

export default async function LibraryPage({
  searchParams
}: {
  searchParams: Promise<{ time?: string; tag?: string; q?: string }>;
}) {
  const user = await requireCurrentUser();
  const t = await getTranslations("library");
  const { time = "all", tag, q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();

  const timeFilter = TIME_FILTERS[time] ?? TIME_FILTERS.all!;
  const dateFilter = timeFilter.days > 0
    ? { gte: new Date(Date.now() - timeFilter.days * 24 * 60 * 60 * 1000) }
    : undefined;

  const matchedPapers = await prisma.workspacePaper.findMany({
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

  // 关键词匹配放在 JS 里做：authors 是 Json 数组，Prisma 的 array_contains 只能整元素相等，
  // 做不了作者名的子串匹配；而单个 workspace 的论文量在几十到几百条，全量取回再过滤足够。
  // 若将来单库论文量上万，应改成 `authors::text ILIKE` 的原生 SQL 或建全文索引。
  const workspacePapers = query
    ? matchedPapers.filter(({ paper }) => {
        if (paper.title.toLowerCase().includes(query)) return true;
        const authors = Array.isArray(paper.authors) ? paper.authors : [];
        return authors.some((author) => typeof author === "string" && author.toLowerCase().includes(query));
      })
    : matchedPapers;

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
  for (const topic of paperTopics) {
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  }

  // Split: preference topics (main) vs discovered topics (more)
  const mainTopics = [...prefTopicSet].filter((topic) => topicCounts.has(topic))
    .sort((a, b) => (topicCounts.get(b) ?? 0) - (topicCounts.get(a) ?? 0));
  const discoveredTopics = [...new Set(paperTopics)]
    .filter((topic) => !prefTopicSet.has(topic))
    .sort((a, b) => (topicCounts.get(b) ?? 0) - (topicCounts.get(a) ?? 0));

  function buildUrl(params: { time?: string | null; tag?: string | null }) {
    const p = new URLSearchParams();
    const newTime = params.time !== undefined ? params.time : time;
    const newTag = params.tag !== undefined ? params.tag : tag;
    if (newTime && newTime !== "all") p.set("time", newTime);
    if (newTag) p.set("tag", newTag);
    if (q) p.set("q", q);
    const qs = p.toString();
    return `/library${qs ? `?${qs}` : ""}`;
  }

  function sourceLabel(source: string) {
    const key = SOURCE_LABEL_KEYS[source];
    return key ? t(key) : source;
  }

  // Check if current tag is a discovered (non-pref) topic
  const isDiscoveredTag = tag && !prefTopicSet.has(tag);

  return (
    <section className="rounded border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <PaperUploadForm />
      </div>

      <div className="border-b border-border px-4 py-2 space-y-1.5">
        <div className="flex items-center gap-1">
          <span className="text-xs font-medium text-muted mr-1">{t("timeLabel")}</span>
          {Object.entries(TIME_FILTERS).map(([key, { labelKey }]) => {
            const isActive = time === key || (key === "all" && !time);
            return (
              <Link
                key={key}
                href={buildUrl({ time: key })}
                className={`rounded px-2 py-0.5 text-xs ${isActive ? "bg-accent text-white" : "text-muted hover:bg-surface"}`}
              >
                {t(labelKey)}
              </Link>
            );
          })}
          <LibrarySearch />
        </div>

        {(mainTopics.length > 0 || discoveredTopics.length > 0) ? (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs font-medium text-muted mr-1">{t("topicsLabel")}</span>
            {mainTopics.map((topic) => {
              const isActive = tag === topic;
              const count = topicCounts.get(topic) ?? 0;
              return (
                <Link
                  key={topic}
                  href={buildUrl({ tag: isActive ? null : topic })}
                  className={`rounded px-2 py-0.5 text-xs ${isActive ? "bg-accent text-white" : "bg-surface text-muted hover:bg-border"}`}
                >
                  {topic} ({count}){isActive ? " ×" : ""}
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
                currentQuery={q}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="px-4 py-2 text-xs text-muted">
        {t("paperCount", { count: workspacePapers.length })}
        {time !== "all" ? ` · ${t(timeFilter.labelKey)}` : ""}
        {tag ? ` · ${tag}` : ""}
        {query ? ` · "${q?.trim()}"` : ""}
      </div>

      <div className="divide-y divide-border">
        {workspacePapers.map(({ paper, tags, id: wpId }) => (
          <div className="flex items-center justify-between px-4 py-4 hover:bg-surface group" key={paper.id}>
            <Link className="min-w-0 flex-1" href={`/papers/${paper.id}`}>
              <h2 className="font-medium">{paper.title}</h2>
              <p className="mt-1 text-sm text-muted">{Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-muted">
                  {paper.source === "arxiv" || paper.source === "hermes" ? `arXiv:${paper.arxivId ?? ""}` : sourceLabel(paper.source)}
                  {/* 与论文详情页的 hasPdf 判定保持一致：Blob 快照也算有 PDF */}
                  {paper.files.length > 0 || paper.blobUrl ? ` · ${t("pdfBadge")}` : ""}
                </span>
                {tags.length > 0 ? (
                  <div className="flex gap-1">
                    {tags.slice(0, 3).map((paperTag) => (
                      <span key={paperTag} className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">{paperTag}</span>
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
            {query ? t("emptySearch") : time !== "all" || tag ? t("emptyFiltered") : t("empty")}
          </p>
        ) : null}
      </div>
    </section>
  );
}
