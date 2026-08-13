import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { isReadingState, readingStates } from "@paper-viewer/core/paper-status";
import { PaperUploadForm } from "@/components/paper-upload-form";
import { MoreTopics } from "@/components/more-topics";
import { LibrarySearch } from "@/components/library-search";
import { FilterDropdown } from "@/components/filter-dropdown";
import { LabelChip } from "@/components/label-chip";
import { TopicChip } from "@/components/topic-chip";
import { requireCurrentUser } from "@/lib/auth";
import { hasStoredPdf } from "@/lib/paper-pdf";
import {
  compareConferenceRefs,
  paperSource,
  sourceFilterKey,
  type PaperSource
} from "@/lib/paper-source";

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
  searchParams: Promise<{
    time?: string;
    tag?: string;
    q?: string;
    label?: string;
    state?: string;
    source?: string;
    savedBy?: string;
  }>;
}) {
  const user = await requireCurrentUser();
  const t = await getTranslations("library");
  const tReadingState = await getTranslations("readingState");
  const locale = await getLocale();
  // The row date answers "does this match my time filter?" at a glance.
  const dateFormat = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" });
  const { time = "all", tag, q, label, state, source, savedBy } = await searchParams;
  const sourceFilter = source || undefined;
  const savedByFilter = savedBy || undefined;
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
      ...(savedByFilter ? { importedById: savedByFilter } : {}),
      ...(label ? { labelLinks: { some: { labelId: label } } } : {})
    },
    include: {
      // conferenceEntries drive both the row's "SOSP 2026" label and the source
      // filter; see paperSource in lib/paper-source.
      paper: {
        include: { files: true, conferenceEntries: { select: { venue: true, year: true } } }
      },
      labelLinks: { include: { label: true }, orderBy: { label: { createdAt: "asc" } } },
      // Anyone may save a paper into the shared library, so the row says who did.
      importedBy: { select: { id: true, name: true, email: true } },
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

  // Source is filtered in JS through the same paperSource() the row label uses,
  // so a paper can never be listed as one source and filtered under another.
  const sourcedPapers = sourceFilter
    ? searchedPapers.filter(
        ({ paper }) => sourceFilterKey(paperSource(paper)) === sourceFilter
      )
    : searchedPapers;

  // Reading state is filtered in JS as well: `new` means "no record at all, or a
  // record that says new", which in Prisma would have to be written as the OR
  // branches `readingStates: { none: {...} } OR { some: { state } }`, whereas for
  // the same volume reasons as above, deciding after the fetch is more
  // straightforward. At larger volumes this should become a single raw query with
  // a LEFT JOIN.
  const workspacePapers = stateFilter
    ? sourcedPapers.filter((workspacePaper) => (workspacePaper.readingStates[0]?.state ?? "new") === stateFilter)
    : sourcedPapers;

  // Collect topics and the paper-label vocabulary. The unfiltered paper scan
  // feeds both the topic counts and the per-label counts, so the filter row
  // always shows the full workspace vocabulary, not just what survives filtering.
  const [allPaperTags, paperLabels] = await Promise.all([
    prisma.workspacePaper.findMany({
      where: { workspaceId: user.workspaceId, state: "visible" },
      select: {
        tags: true,
        labelLinks: { select: { labelId: true } },
        importedBy: { select: { id: true, name: true, email: true } },
        paper: {
          select: { source: true, conferenceEntries: { select: { venue: true, year: true } } }
        }
      }
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

  const paperTopics = allPaperTags.flatMap((p) => p.tags);

  // Count papers per topic
  const topicCounts = new Map<string, number>();
  for (const topic of paperTopics) {
    topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
  }

  // One rule for every topic, wherever it came from: the most-used ones sit
  // inline, the rest fold into "More". (Preference topics used to be pinned,
  // which read as one arbitrary chip being always visible.)
  const TOP_TOPICS = 3;
  const rankedTopics = [...new Set(paperTopics)].sort(
    (a, b) => (topicCounts.get(b) ?? 0) - (topicCounts.get(a) ?? 0) || a.localeCompare(b)
  );
  const mainTopics = rankedTopics.slice(0, TOP_TOPICS);
  const discoveredTopics = rankedTopics.slice(TOP_TOPICS);

  /** Every filter link rebuilds the whole query string, so the other params always survive. */
  function buildUrl(params: {
    time?: string | null;
    tag?: string | null;
    label?: string | null;
    state?: string | null;
    source?: string | null;
    savedBy?: string | null;
  }) {
    const p = new URLSearchParams();
    const newTime = params.time !== undefined ? params.time : time;
    const newTag = params.tag !== undefined ? params.tag : tag;
    const newLabel = params.label !== undefined ? params.label : label;
    const newState = params.state !== undefined ? params.state : stateFilter;
    const newSource = params.source !== undefined ? params.source : sourceFilter;
    const newSavedBy = params.savedBy !== undefined ? params.savedBy : savedByFilter;
    if (newTime && newTime !== "all") p.set("time", newTime);
    if (newTag) p.set("tag", newTag);
    if (newLabel) p.set("label", newLabel);
    if (newState) p.set("state", newState);
    if (newSource) p.set("source", newSource);
    if (newSavedBy) p.set("savedBy", newSavedBy);
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

  /**
   * One option per source actually present in the library, so an empty bucket
   * is never offered. Conference editions are listed individually ("SOSP 2026"),
   * which is the level a reader thinks at — a single "conference" option would
   * repeat the same gap the row label had.
   */
  function sourceOptionLabel(paperSourceValue: ReturnType<typeof paperSource>): string {
    switch (paperSourceValue.kind) {
      case "conference":
        return `${paperSourceValue.venue} ${paperSourceValue.year}`;
      case "arxiv":
        return t("sourceArxiv");
      case "manual":
        return t("sourceManual");
      default:
        return paperSourceValue.source;
    }
  }

  const sourceCounts = new Map<string, { label: string; count: number; sort: PaperSource }>();
  for (const { paper } of allPaperTags) {
    const value = paperSource(paper);
    const key = sourceFilterKey(value);
    const existing = sourceCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      sourceCounts.set(key, { label: sourceOptionLabel(value), count: 1, sort: value });
    }
  }
  // Conferences first, newest edition on top, then arXiv and manual uploads.
  const rankedSources = [...sourceCounts.entries()].sort(([, a], [, b]) => {
    if (a.sort.kind === "conference" && b.sort.kind === "conference") {
      return compareConferenceRefs(a.sort, b.sort);
    }
    if (a.sort.kind === "conference") return -1;
    if (b.sort.kind === "conference") return 1;
    return a.label.localeCompare(b.label);
  });
  const sourceOptions = [
    { value: "", label: t("sourceAll"), href: buildUrl({ source: null }) },
    ...rankedSources.map(([value, { label: optionLabel, count }]) => ({
      value,
      label: optionLabel,
      href: buildUrl({ source: value }),
      count
    }))
  ];
  const activeSourceLabel = sourceFilter ? sourceCounts.get(sourceFilter)?.label : undefined;

  /** Who saved what, counted over the whole library so the list never shrinks with the filter. */
  const saverCounts = new Map<string, { label: string; count: number }>();
  for (const { importedBy } of allPaperTags) {
    // Papers imported before the workspace tracked it, or by a since-removed
    // member, have no saver; they simply carry no chip and no option.
    if (!importedBy) continue;
    const existing = saverCounts.get(importedBy.id);
    if (existing) existing.count += 1;
    else saverCounts.set(importedBy.id, { label: importedBy.name ?? importedBy.email, count: 1 });
  }
  const savedByOptions = [
    { value: "", label: t("savedByAll"), href: buildUrl({ savedBy: null }) },
    ...[...saverCounts.entries()]
      .sort(([, a], [, b]) => b.count - a.count || a.label.localeCompare(b.label))
      .map(([id, { label: saverLabel, count }]) => ({
        value: id,
        label: saverLabel,
        href: buildUrl({ savedBy: id }),
        count
      }))
  ];
  const activeSaverLabel = savedByFilter ? saverCounts.get(savedByFilter)?.label : undefined;

  const readingStateOptions = [
    { value: "", label: t("stateAll"), href: buildUrl({ state: null }) },
    ...readingStates.map((readingState) => ({
      value: readingState,
      label: tReadingState(readingState),
      href: buildUrl({ state: readingState })
    }))
  ];

  /**
   * The row's origin line. A conference paper names its edition ("SOSP 2026");
   * anything else keeps the arXiv id, which is the identifier a reader would
   * actually copy.
   */
  function rowSourceText(paper: { source: string; arxivId: string | null; conferenceEntries: { venue: string; year: number }[] }) {
    const value = paperSource(paper);
    if (value.kind === "conference") return `${value.venue} ${value.year}`;
    if (value.kind === "arxiv") return `arXiv:${paper.arxivId ?? ""}`;
    const key = SOURCE_LABEL_KEYS[paper.source];
    return key ? t(key) : paper.source;
  }

  // The active topic must stay visible as a dismissible chip even when it
  // ranks below the inline cut (it normally lives inside "More").
  const isOverflowTag = Boolean(tag) && !mainTopics.includes(tag ?? "");

  return (
    <section className="rounded border border-border bg-white shadow-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <PaperUploadForm />
      </div>

      <div className="border-b border-border px-4 py-2 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <FilterDropdown prefix={t("timeLabel")} value={time} options={timeOptions} />
          {/* One source means the filter can only ever be a no-op. */}
          {sourceCounts.size > 1 ? (
            <FilterDropdown prefix={t("sourceFilterLabel")} value={sourceFilter ?? ""} options={sourceOptions} />
          ) : null}
          {/* Shown as soon as anyone is on record. Unlike the source filter,
              this dimension is about people: a workspace gains members, and a
              control that appears only once a second person saves something is
              a control nobody knows to look for. */}
          {saverCounts.size > 0 ? (
            <FilterDropdown
              prefix={t("savedByLabel")}
              value={savedByFilter ?? ""}
              options={savedByOptions}
            />
          ) : null}
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
            {tag && isOverflowTag ? (
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
          {activeSourceLabel ? ` · ${activeSourceLabel}` : ""}
          {activeSaverLabel ? ` · ${t("savedBy", { name: activeSaverLabel })}` : ""}
          {activeLabel ? ` · ${activeLabel.name}` : ""}
          {stateFilter ? ` · ${tReadingState(stateFilter)}` : ""}
          {query ? ` · "${q?.trim()}"` : ""}
        </span>
        {time !== "all" || tag || label || stateFilter || sourceFilter || savedByFilter || query ? (
          <Link className="text-accent hover:underline" href="/library">
            {t("clearFilters")}
          </Link>
        ) : null}
      </div>

      <div className="divide-y divide-border">
        {workspacePapers.map(({ paper, tags, labelLinks, createdAt, importedBy }) => (
          <div className="flex items-center justify-between px-4 py-4 transition-colors duration-150 hover:bg-surface" key={paper.id}>
            <Link className="min-w-0 flex-1" href={`/papers/${paper.id}`}>
              <h2 className="font-medium">{paper.title}</h2>
              <p className="mt-1 text-sm text-muted">{Array.isArray(paper.authors) ? paper.authors.join(", ") : ""}</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-muted">
                  {dateFormat.format(createdAt)}
                  {" · "}
                  {rowSourceText(paper)}
                  {hasStoredPdf(paper) ? ` · ${t("pdfBadge")}` : ""}
                  {importedBy ? ` · ${t("savedBy", { name: importedBy.name ?? importedBy.email })}` : ""}
                </span>
                {tags.length > 0 ? (
                  <div className="flex gap-1">
                    {tags.slice(0, 3).map((paperTag) => (
                      <TopicChip key={paperTag} topic={paperTag} size="sm" />
                    ))}
                  </div>
                ) : null}
              </div>
            </Link>
            {/* The row carries no actions at all: reading state, removal and the
                arXiv link all live on the paper page, one click away, where they
                cannot be hit by accident on a dense list. Only the labels show
                here, on the right where the freed-up space is. */}
            <div className="flex shrink-0 items-center gap-2">
              {labelLinks.map(({ label: paperLabel }) => (
                <LabelChip key={paperLabel.id} name={paperLabel.name} color={paperLabel.color} />
              ))}
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
