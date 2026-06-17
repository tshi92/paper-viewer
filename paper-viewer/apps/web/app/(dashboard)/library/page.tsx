import Link from "next/link";
import { prisma } from "@paper-viewer/db";
import { PaperUploadForm } from "@/components/paper-upload-form";
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

  // Build time filter
  const timeFilter = TIME_FILTERS[time] ?? TIME_FILTERS.all!;
  const dateFilter = timeFilter.days > 0
    ? { gte: new Date(Date.now() - timeFilter.days * 24 * 60 * 60 * 1000) }
    : undefined;

  // Fetch papers with filters
  const workspacePapers = await prisma.workspacePaper.findMany({
    where: {
      workspaceId: user.workspaceId,
      state: "visible",
      ...(dateFilter ? { createdAt: dateFilter } : {}),
      ...(tag ? { tags: { has: tag } } : {})
    },
    include: {
      paper: {
        include: { files: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  // Collect all unique tags for the filter bar
  const allPapers = await prisma.workspacePaper.findMany({
    where: { workspaceId: user.workspaceId, state: "visible" },
    select: { tags: true }
  });
  const allTags = [...new Set(allPapers.flatMap((p) => p.tags))].sort();

  // Get research preference topics as additional tag options
  const prefs = await prisma.researchPreferences.findUnique({
    where: { workspaceId: user.workspaceId },
    select: { topics: true, keywords: true }
  });
  const prefTags = [...new Set([...(prefs?.keywords ?? []), ...(prefs?.topics ?? [])])];
  const combinedTags = [...new Set([...allTags, ...prefTags])].sort();

  function filterUrl(params: { time?: string; tag?: string }) {
    const p = new URLSearchParams();
    const t = params.time ?? time;
    const g = params.tag ?? tag;
    if (t && t !== "all") p.set("time", t);
    if (g) p.set("tag", g);
    const qs = p.toString();
    return `/library${qs ? `?${qs}` : ""}`;
  }

  return (
    <section className="rounded border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">Library</h1>
        <PaperUploadForm />
      </div>

      {/* Filters */}
      <div className="border-b border-border px-4 py-2">
        <div className="flex flex-wrap items-center gap-4">
          {/* Time filters */}
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-muted mr-1">Time:</span>
            {Object.entries(TIME_FILTERS).map(([key, { label }]) => (
              <Link
                key={key}
                href={filterUrl({ time: key, tag: tag === undefined ? undefined : tag })}
                className={`rounded px-2 py-0.5 text-xs ${time === key || (key === "all" && !time) ? "bg-accent text-white" : "text-muted hover:bg-surface"}`}
              >
                {label}
              </Link>
            ))}
          </div>

          {/* Tag filters */}
          {combinedTags.length > 0 ? (
            <div className="flex items-center gap-1 overflow-x-auto">
              <span className="text-xs font-medium text-muted mr-1">Tags:</span>
              {tag ? (
                <Link
                  href={filterUrl({ tag: undefined, time })}
                  className="rounded bg-accent px-2 py-0.5 text-xs text-white"
                >
                  {tag} ×
                </Link>
              ) : null}
              {combinedTags.filter((t) => t !== tag).slice(0, 15).map((t) => (
                <Link
                  key={t}
                  href={filterUrl({ tag: t })}
                  className="rounded bg-surface px-2 py-0.5 text-xs text-muted hover:bg-border"
                >
                  {t}
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* Results count */}
      <div className="px-4 py-2 text-xs text-muted">
        {workspacePapers.length} paper{workspacePapers.length !== 1 ? "s" : ""}
        {time !== "all" ? ` · ${timeFilter.label}` : ""}
        {tag ? ` · #${tag}` : ""}
      </div>

      {/* Paper list */}
      <div className="divide-y divide-border">
        {workspacePapers.map(({ paper, tags }) => (
          <div className="flex items-center justify-between px-4 py-4 hover:bg-surface" key={paper.id}>
            <Link className="min-w-0 flex-1" href={`/papers/${paper.id}`}>
              <h2 className="font-medium">{paper.title}</h2>
              <p className="mt-1 text-sm text-muted">{Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-muted">
                  {paper.source === "arxiv" || paper.source === "hermes" ? `arXiv:${paper.arxivId ?? ""}` : paper.source}
                  {paper.files.length > 0 ? " · PDF" : ""}
                </span>
                {tags.length > 0 ? (
                  <div className="flex gap-1">
                    {tags.slice(0, 4).map((t) => (
                      <span key={t} className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-muted">{t}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </Link>
            {paper.arxivId ? (
              <a
                href={`https://arxiv.org/abs/${paper.arxivId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-3 shrink-0 rounded border border-border px-2.5 py-1 text-xs text-accent hover:bg-surface"
              >
                arXiv
              </a>
            ) : null}
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
