import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { FilterLink } from "@/components/filter-link";
import { InLibraryLink } from "@/components/in-library-link";
import { SaveToLibraryButton } from "@/components/save-to-library-button";
import { ArxivIcon } from "@/components/arxiv-icon";
import { ScholarIcon } from "@/components/scholar-icon";
import { canRenderPdf, isPreprintPdf } from "@/lib/paper-pdf";

/**
 * Rows rendered per page. A program runs to 483 papers, and rendering all of
 * them cost ~1.2MB of RSC payload and several thousand DOM nodes per switch —
 * the catalog felt frozen for a second or more on every chip click. Scanning
 * proceedings is a page-at-a-time activity anyway.
 */
const PAGE_SIZE = 50;

export type CatalogSelection = { venue: string; year: number } | null;

/**
 * The catalog's result list: the papers of the selected program (or of a
 * search across every program), one page at a time.
 *
 * It is a separate component only to keep the page file readable.
 *
 * Its filter and pager links go through FilterLink for the same reason as the
 * chip rail: on this route, client-side search-param navigation silently drops
 * a quarter of clicks in production builds.
 */
export async function CatalogList({
  workspaceId,
  selected,
  query,
  rawQuery,
  page: requestedPage
}: {
  workspaceId: string;
  /** The chosen program, or null while a search spans the whole catalog. */
  selected: CatalogSelection;
  /** Lowercased search term used for matching. */
  query: string;
  /** The term as typed, for display. */
  rawQuery: string | undefined;
  page: string | undefined;
}) {
  const t = await getTranslations("conferences");
  const tCommon = await getTranslations("common");

  const entries = await prisma.conferenceEntry.findMany({
    where: selected ? { venue: selected.venue, year: selected.year } : {},
    orderBy: [{ year: "desc" }, { venue: "asc" }, { createdAt: "asc" }],
    include: {
      paper: {
        select: {
          id: true,
          title: true,
          authors: true,
          externalUrl: true,
          // Everything the preview page can render inline from: a direct
          // PDF link, an arXiv id, or an already-pinned snapshot.
          pdfUrl: true,
          arxivId: true,
          blobUrl: true,
          // Tells the badge whether the inline PDF is the conference's own
          // file or an arXiv preprint standing in for it.
          source: true,
          // Present only once someone saved the paper to the library.
          workspacePapers: { where: { workspaceId }, select: { id: true } }
        }
      }
    }
  });

  const matched = query
    ? entries.filter(({ paper }) => {
        if (paper.title.toLowerCase().includes(query)) return true;
        const authors = Array.isArray(paper.authors) ? paper.authors : [];
        return authors.some(
          (author) => typeof author === "string" && author.toLowerCase().includes(query)
        );
      })
    : entries;

  const pageCount = Math.max(1, Math.ceil(matched.length / PAGE_SIZE));
  // An out-of-range ?page= (a stale link, a program that shrank) clamps rather
  // than showing an empty list.
  const page = Math.min(Math.max(1, Number(requestedPage) || 1), pageCount);
  const firstIndex = (page - 1) * PAGE_SIZE;
  const rows = matched.slice(firstIndex, firstIndex + PAGE_SIZE);

  /** Paging keeps the current program and search; only the page number moves. */
  function pageHref(target: number) {
    const params = new URLSearchParams();
    if (selected) {
      params.set("venue", selected.venue);
      params.set("year", String(selected.year));
    }
    if (rawQuery) params.set("q", rawQuery);
    if (target > 1) params.set("page", String(target));
    const qs = params.toString();
    return `/conferences${qs ? `?${qs}` : ""}`;
  }

  return (
    <>
      <div className="flex items-center gap-2 text-xs text-muted">
        <span className="tabular-nums">
          {query
            ? `${t("count", { count: matched.length })} · "${rawQuery?.trim()}"`
            : selected
              ? `${selected.venue} ${selected.year} · ${t("count", { count: matched.length })}`
              : t("count", { count: matched.length })}
        </span>
        {query ? (
          <FilterLink className="text-accent hover:underline" href="/conferences">
            {t("clearFilters")}
          </FilterLink>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded border border-border bg-white shadow-card px-6 py-12 text-center">
          <p className="text-sm text-muted">{t("emptyFiltered")}</p>
          <FilterLink className="text-sm text-accent hover:underline" href="/conferences">
            {t("clearFilters")}
          </FilterLink>
        </div>
      ) : (
        <section className="rounded border border-border bg-white shadow-card">
          {rows.map((entry) => {
            const paper = entry.paper;
            const saved = paper.workspacePapers.length > 0;
            return (
              <div
                key={entry.id}
                // Stacked on a phone — the chip cluster otherwise squeezes
                // the title into a one-word-per-line column.
                className="flex flex-col gap-2 border-t border-t-border px-4 py-3 first:border-t-0 md:flex-row md:items-center md:justify-between md:gap-4"
              >
                {/* Deliberately static: the row is a catalog line, not a
                    link — only the actions on the right navigate. */}
                <div className="min-w-0 flex-1">
                  <h3 className="font-medium leading-snug">{paper.title}</h3>
                  <p className="mt-0.5 line-clamp-1 text-sm text-muted">
                    {query ? `${entry.venue} ${entry.year} · ` : ""}
                    {Array.isArray(paper.authors) ? (paper.authors as string[]).join(", ") : ""}
                  </p>
                </div>
                {/* One set of chips, all the same height, radius and tone.
                    The row used to end in a ring-outlined badge, a text link
                    with a trailing arrow and a bare icon — three weights for
                    three things, repeated down a long list. They are all
                    secondary to the save action at the end of the row, so
                    none of them takes the accent colour. */}
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {/* Signals before the click that the paper page will show
                      the full text inline; absent when it can't. Papers with
                      no publisher PDF are served from arXiv, so the badge
                      says so rather than implying the version of record. */}
                  {canRenderPdf(paper) ? (
                    <Link
                      href={`/papers/${paper.id}?from=conferences`}
                      title={isPreprintPdf(paper) ? tCommon("preprintNote") : t("pdfBadgeTitle")}
                      className="flex h-6 items-center rounded-md bg-surface px-2.5 text-xs font-medium text-muted transition-colors duration-150 hover:bg-border hover:text-ink"
                    >
                      {t("pdfBadge")}
                      {/* Served from arXiv rather than by the conference:
                          the mark says it in the space of a glyph, and the
                          link's title still explains what it implies. */}
                      {isPreprintPdf(paper) ? <ArxivIcon className="ml-1.5 h-3.5 w-auto" /> : null}
                    </Link>
                  ) : null}
                  {paper.externalUrl ? (
                    <a
                      href={paper.externalUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-6 items-center rounded-md bg-surface px-2.5 text-xs font-medium text-muted transition-colors duration-150 hover:bg-border hover:text-ink"
                    >
                      {t("sourceChip")}
                    </a>
                  ) : null}
                  {/* Offered even when the publisher page exists: the two
                      answer different questions, one being "read the version
                      of record" and the other "what else is out there, who
                      cites it, is there a preprint". */}
                  <a
                    href={`https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("scholarLink")}
                    title={t("scholarLink")}
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-surface transition-colors duration-150 hover:bg-border"
                  >
                    <ScholarIcon />
                  </a>
                  <span className="ml-1">
                    {saved ? (
                      <InLibraryLink paperId={paper.id} />
                    ) : (
                      <SaveToLibraryButton paperId={paper.id} />
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {pageCount > 1 ? (
        <nav
          aria-label={t("pagination")}
          className="flex items-center justify-between gap-3 text-xs text-muted"
        >
          <span className="tabular-nums">
            {t("pageRange", {
              from: firstIndex + 1,
              to: firstIndex + rows.length,
              total: matched.length
            })}
          </span>
          <span className="flex items-center gap-2">
            {page > 1 ? (
              <FilterLink
                className="rounded border border-border bg-white px-2 py-1 hover:text-ink"
                href={pageHref(page - 1)}
              >
                {t("previousPage")}
              </FilterLink>
            ) : null}
            <span className="tabular-nums">{t("pageOf", { page, pageCount })}</span>
            {page < pageCount ? (
              <FilterLink
                className="rounded border border-border bg-white px-2 py-1 hover:text-ink"
                href={pageHref(page + 1)}
              >
                {t("nextPage")}
              </FilterLink>
            ) : null}
          </span>
        </nav>
      ) : null}
    </>
  );
}
