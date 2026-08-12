import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { isReadingState, readingStates, type ReadingState } from "@paper-viewer/core/paper-status";
import { PaperUploadForm } from "@/components/paper-upload-form";
import { RemovePaperButton } from "@/components/remove-paper-button";
import { MoreTopics } from "@/components/more-topics";
import { LibrarySearch } from "@/components/library-search";
import { FilterDropdown } from "@/components/filter-dropdown";
import { ReadingStateChips } from "@/components/reading-state-chips";
import { LabelChip } from "@/components/label-chip";
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
  searchParams: Promise<{ time?: string; tag?: string; q?: string; label?: string; state?: string }>;
}) {
  const user = await requireCurrentUser();
  const t = await getTranslations("library");
  const tReadingState = await getTranslations("readingState");
  const locale = await getLocale();
  // The row date answers "does this match my time filter?" at a glance.
  const dateFormat = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const { time = "all", tag, q, label, state } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();
  // An unknown `?state=` behaves like no reading-state filter at all.
  const stateFilter = state && isReadingState(state) ? state : undefined;

  const timeFilter = TIME_FILTERS[time] ?? TIME_FILTERS.all!;
  const dateFilter = timeFilter.days > 0
    ? { gte: new Date(Date.now() - timeFilter.days * 24 * 60 * 60 * 1000) }
    : undefined;

  const matchedPapers = await prisma.workspacePaper.findMany({
    where: {
      workspaceId: user.workspaceId,
      state: "visible",
      ...(dateFilter ? { createdAt: dateFilter } : {}),
      ...(tag ? { tags: { has: tag } } : {}),
      ...(label ? { labelLinks: { some: { labelId: label } } } : {})
    },
    include: {
      paper: { include: { files: true } },
      labelLinks: { include: { label: true }, orderBy: { label: { createdAt: "asc" } } },
      // Reading state is per user, so the filter below only ever sees the viewer's own record.
      readingStates: { where: { userId: user.id }, select: { state: true } }
    },
    orderBy: { createdAt: "desc" }
  });

  // Keyword matching is done in JS: authors is a Json array and Prisma's
  // array_contains can only test whole-element equality, so it cannot do substring
  // matching on an author name; and since a single workspace holds tens to
  // hundreds of papers, fetching them all and filtering afterwards is good enough.
  // If a single library ever grows to tens of thousands of papers, this should
  // become raw SQL using `authors::text ILIKE`, or get a full-text index.
  const searchedPapers = query
    ? matchedPapers.filter(({ paper }) => {
        if (paper.title.toLowerCase().includes(query)) return true;
        const authors = Array.isArray(paper.authors) ? paper.authors : [];
        return authors.some((author) => typeof author === "string" && author.toLowerCase().includes(query));
      })
    : matchedPapers;

  // Reading state is filtered in JS as well: `new` means "no record at all, or a
  // record that says new", which in Prisma would have to be written as the OR
  // branches `readingStates: { none: {...} } OR { some: { state } }`, whereas for
  // the same volume reasons as above, deciding after the fetch is more
  // straightforward. At larger volumes this should become a single raw query with
  // a LEFT JOIN.
  const workspacePapers = stateFilter
    ? searchedPapers.filter((workspacePaper) => (workspacePaper.readingStates[0]?.state ?? "new") === stateFilter)
    : searchedPapers;

  // Collect topics and the paper-label vocabulary. The unfiltered paper scan
  // feeds both the topic counts and the per-label counts, so the filter row
  // always shows the full workspace vocabulary, not just what survives filtering.
  const [allPaperTags, prefs, paperLabels] = await Promise.all([
    prisma.workspacePaper.findMany({
      where: { workspaceId: user.workspaceId, state: "visible" },
      select: { tags: true, labelLinks: { select: { labelId: true } } }
    }),
    prisma.researchPreferences.findUnique({
      where: { workspaceId: user.workspaceId },
      select: { topics: true, keywords: true }
    }),
    prisma.label.findMany({
      where: { workspaceId: user.workspaceId, scope: "paper" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, color: true }
    })
  ]);

  const labelCounts = new Map<string, number>();
  for (const paper of allPaperTags) {
    for (const link of paper.labelLinks) {
      labelCounts.set(link.labelId, (labelCounts.get(link.labelId) ?? 0) + 1);
    }
  }
  const activeLabel = label ? paperLabels.find((it) => it.id === label) : undefined;

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

  /** Every filter link rebuilds the whole query string, so the other three params always survive. */
  function buildUrl(params: {
    time?: string | null;
    tag?: string | null;
    label?: string | null;
    state?: string | null;
  }) {
    const p = new URLSearchParams();
    const newTime = params.time !== undefined ? params.time : time;
    const newTag = params.tag !== undefined ? params.tag : tag;
    const newLabel = params.label !== undefined ? params.label : label;
    const newState = params.state !== undefined ? params.state : stateFilter;
    if (newTime && newTime !== "all") p.set("time", newTime);
    if (newTag) p.set("tag", newTag);
    if (newLabel) p.set("label", newLabel);
    if (newState) p.set("state", newState);
    if (q) p.set("q", q);
    const qs = p.toString();
    return `/library${qs ? `?${qs}` : ""}`;
  }

  const timeOptions = Object.entries(TIME_FILTERS).map(([key, { labelKey }]) => ({
    value: key,
    label: t(labelKey),
    href: buildUrl({ time: key })
  }));

  const labelOptions = [
    { value: "", label: t("labelAll"), href: buildUrl({ label: null }) },
    ...paperLabels.map((paperLabel) => ({
      value: paperLabel.id,
      label: paperLabel.name,
      href: buildUrl({ label: paperLabel.id }),
      count: labelCounts.get(paperLabel.id) ?? 0,
      color: paperLabel.color
    }))
  ];

  const readingStateOptions = [
    { value: "", label: t("stateAll"), href: buildUrl({ state: null }) },
    ...readingStates.map((readingState) => ({
      value: readingState,
      label: tReadingState(readingState),
      href: buildUrl({ state: readingState })
    }))
  ];

  function sourceLabel(source: string) {
    const key = SOURCE_LABEL_KEYS[source];
    return key ? t(key) : source;
  }

  // Check if current tag is a discovered (non-pref) topic
  const isDiscoveredTag = tag && !prefTopicSet.has(tag);

  return (
    <section className="rounded border border-border bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <PaperUploadForm />
      </div>

      <div className="border-b border-border px-4 py-2 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown prefix={t("timeLabel")} value={time} options={timeOptions} />
          {paperLabels.length > 0 ? (
            <FilterDropdown prefix={t("labelsLabel")} value={label ?? ""} options={labelOptions} />
          ) : null}
          <FilterDropdown prefix={t("readingStateLabel")} value={stateFilter ?? ""} options={readingStateOptions} />
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
                  className={`rounded px-2 py-0.5 text-xs ${isActive ? "bg-accent text-white" : "bg-surface text-muted hover:bg-border hover:text-ink"}`}
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
                currentLabel={label}
                currentState={stateFilter}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-2 px-4 py-2 text-xs text-muted">
        <span className="tabular-nums">
          {t("paperCount", { count: workspacePapers.length })}
          {time !== "all" ? ` · ${t(timeFilter.labelKey)}` : ""}
          {tag ? ` · ${tag}` : ""}
          {activeLabel ? ` · ${activeLabel.name}` : ""}
          {stateFilter ? ` · ${tReadingState(stateFilter)}` : ""}
          {query ? ` · "${q?.trim()}"` : ""}
        </span>
        {time !== "all" || tag || label || stateFilter || query ? (
          <Link className="text-accent hover:underline" href="/library">
            {t("clearFilters")}
          </Link>
        ) : null}
      </div>

      <div className="divide-y divide-border">
        {workspacePapers.map(({ paper, tags, labelLinks, readingStates: rowStates, createdAt, id: wpId }) => (
          <div className="flex items-center justify-between px-4 py-4 transition-colors duration-150 hover:bg-surface group" key={paper.id}>
            <Link className="min-w-0 flex-1" href={`/papers/${paper.id}`}>
              <h2 className="font-medium">{paper.title}</h2>
              <p className="mt-1 text-sm text-muted">{Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-muted">
                  {dateFormat.format(createdAt)}
                  {" · "}
                  {paper.source === "arxiv" || paper.source === "hermes" ? `arXiv:${paper.arxivId ?? ""}` : sourceLabel(paper.source)}
                  {/* Kept consistent with the hasPdf check on the paper detail page: a Blob snapshot counts as having a PDF */}
                  {paper.files.length > 0 || paper.blobUrl ? ` · ${t("pdfBadge")}` : ""}
                </span>
                {labelLinks.length > 0 ? (
                  <div className="flex gap-1">
                    {labelLinks.map(({ label: paperLabel }) => (
                      <LabelChip key={paperLabel.id} name={paperLabel.name} color={paperLabel.color} />
                    ))}
                  </div>
                ) : null}
                {tags.length > 0 ? (
                  <div className="flex gap-1">
                    {tags.slice(0, 3).map((paperTag) => (
                      <span key={paperTag} className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted">{paperTag}</span>
                    ))}
                  </div>
                ) : null}
              </div>
            </Link>
            <div className="flex items-center gap-2">
              {/* Prisma's ReadingState enum and the core union carry the same members. */}
              <ReadingStateChips
                paperId={paper.id}
                state={(rowStates[0]?.state ?? "new") as ReadingState}
              />
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
              <RemovePaperButton workspacePaperId={wpId} paperTitle={paper.title} />
            </div>
          </div>
        ))}
        {workspacePapers.length === 0 ? (
          <div className="px-4 py-8 text-sm text-muted">
            <p>
              {query ? t("emptySearch") : time !== "all" || tag || label || stateFilter ? t("emptyFiltered") : t("empty")}
            </p>
            {query || time !== "all" || tag || label || stateFilter ? (
              <Link className="mt-2 inline-block text-accent hover:underline" href="/library">
                {t("clearFilters")}
              </Link>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
