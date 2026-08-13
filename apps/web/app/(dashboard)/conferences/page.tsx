import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";
import { ConferenceSyncButton } from "@/components/conference-sync-button";
import { InLibraryLink } from "@/components/in-library-link";
import { LibrarySearch } from "@/components/library-search";
import { SaveToLibraryButton } from "@/components/save-to-library-button";
import { canRenderPdf, isPreprintPdf } from "@/lib/paper-pdf";

// A single program never comes close to this; only a broad search can, and
// the truncation is announced in the UI, never silent.
const MAX_ROWS = 500;

/**
 * The catalog reads like conference proceedings: pick a program (venue+year
 * chip) and scan a dense list, or search across everything. Browsing "all
 * 2000 papers" is not a real task, so there is no unfiltered firehose view —
 * the newest program opens by default.
 */
export default async function ConferencesPage({
  searchParams
}: {
  searchParams: Promise<{ venue?: string; year?: string; q?: string }>;
}) {
  const user = await requireCurrentUser();
  const t = await getTranslations("conferences");
  const tCommon = await getTranslations("common");
  const { venue: rawVenue, year: rawYear, q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();

  const facets = await prisma.conferenceEntry.groupBy({
    by: ["venue", "year"],
    _count: { _all: true },
    orderBy: [{ year: "desc" }, { venue: "asc" }]
  });

  // An explicit selection wins; otherwise the newest year's first program.
  // A search spans the whole catalog and ignores the chip selection.
  const validSelection = facets.find(
    (facet) => facet.venue === rawVenue && (!rawYear || String(facet.year) === rawYear)
  );
  const selected = query
    ? null
    : validSelection
      ? { venue: validSelection.venue, year: validSelection.year }
      : facets.length > 0
        ? { venue: facets[0]!.venue, year: facets[0]!.year }
        : null;

  const entries = facets.length
    ? await prisma.conferenceEntry.findMany({
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
              workspacePapers: { where: { workspaceId: user.workspaceId }, select: { id: true } }
            }
          }
        }
      })
    : [];

  const matched = query
    ? entries.filter(({ paper }) => {
        if (paper.title.toLowerCase().includes(query)) return true;
        const authors = Array.isArray(paper.authors) ? paper.authors : [];
        return authors.some(
          (author) => typeof author === "string" && author.toLowerCase().includes(query)
        );
      })
    : entries;
  const truncated = matched.length > MAX_ROWS;
  const rows = truncated ? matched.slice(0, MAX_ROWS) : matched;

  const years = [...new Set(facets.map((facet) => facet.year))];
  const canSync = canManageWorkspaceSettings(user.role);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <LibrarySearch basePath="/conferences" />
          {canSync ? <ConferenceSyncButton /> : null}
        </div>
      </div>

      {facets.length > 0 ? (
        <div className="space-y-1.5">
          {years.map((year) => (
            <div key={year} className="flex flex-wrap items-center gap-1.5">
              <span className="w-10 text-xs font-medium tabular-nums text-muted">{year}</span>
              {facets
                .filter((facet) => facet.year === year)
                .map((facet) => {
                  const isActive = selected?.venue === facet.venue && selected?.year === facet.year;
                  return (
                    <Link
                      key={`${facet.venue}-${facet.year}`}
                      href={`/conferences?venue=${encodeURIComponent(facet.venue)}&year=${facet.year}`}
                      aria-current={isActive ? "true" : undefined}
                      className={`rounded px-2 py-0.5 text-xs tabular-nums transition-colors duration-150 ${
                        isActive
                          ? "bg-accent text-white"
                          : "bg-white text-muted ring-1 ring-inset ring-border hover:text-ink"
                      }`}
                    >
                      {facet.venue} · {facet._count._all}
                    </Link>
                  );
                })}
            </div>
          ))}
        </div>
      ) : null}

      {facets.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded border border-border bg-white shadow-card px-6 py-16 text-center">
          <h2 className="text-lg font-semibold">{t("emptyTitle")}</h2>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            {canSync ? t("emptyBodyAdmin") : t("emptyBody")}
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-muted">
            <span className="tabular-nums">
              {query
                ? `${t("count", { count: matched.length })} · "${q?.trim()}"`
                : selected
                  ? `${selected.venue} ${selected.year} · ${t("count", { count: matched.length })}`
                  : t("count", { count: matched.length })}
            </span>
            {query ? (
              <Link className="text-accent hover:underline" href="/conferences">
                {t("clearFilters")}
              </Link>
            ) : null}
          </div>

          {truncated ? (
            <p className="rounded border border-border bg-surface px-4 py-2 text-sm text-muted">
              {t("truncatedNotice", { max: MAX_ROWS })}
            </p>
          ) : null}

          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded border border-border bg-white shadow-card px-6 py-12 text-center">
              <p className="text-sm text-muted">{t("emptyFiltered")}</p>
              <Link className="text-sm text-accent hover:underline" href="/conferences">
                {t("clearFilters")}
              </Link>
            </div>
          ) : (
            <section className="rounded border border-border bg-white shadow-card">
              {rows.map((entry) => {
                const paper = entry.paper;
                const saved = paper.workspacePapers.length > 0;
                return (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-4 border-t border-t-border px-4 py-3 first:border-t-0"
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
                    <div className="flex shrink-0 items-center gap-3">
                      {/* Signals before the click that the paper page will show
                          the full text inline; absent when it can't. Papers with
                          no publisher PDF are served from arXiv, so the badge
                          says so rather than implying the version of record. */}
                      {canRenderPdf(paper) ? (
                        <Link
                          href={`/papers/${paper.id}?from=conferences`}
                          title={isPreprintPdf(paper) ? tCommon("preprintNote") : t("pdfBadgeTitle")}
                          className="rounded px-1.5 py-0.5 text-xs font-medium text-accent ring-1 ring-inset ring-accent/30 transition-colors duration-150 hover:bg-accent/5"
                        >
                          {isPreprintPdf(paper) ? t("pdfBadgeArxiv") : t("pdfBadge")}
                        </Link>
                      ) : null}
                      <a
                        href={
                          paper.externalUrl ??
                          `https://scholar.google.com/scholar?q=${encodeURIComponent(paper.title)}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        title={paper.externalUrl ? undefined : t("scholarLinkTitle")}
                        className="whitespace-nowrap text-xs text-accent hover:underline"
                      >
                        {paper.externalUrl ? tCommon("sourceLink") : t("scholarLink")} ↗
                      </a>
                      {saved ? (
                        <InLibraryLink paperId={paper.id} />
                      ) : (
                        <SaveToLibraryButton paperId={paper.id} />
                      )}
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
}
