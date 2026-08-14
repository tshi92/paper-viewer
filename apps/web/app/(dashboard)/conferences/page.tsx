import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";
import { ConferenceSyncButton } from "@/components/conference-sync-button";
import { FilterLink } from "@/components/filter-link";
import { LibrarySearch } from "@/components/library-search";
import { CatalogList } from "./catalog-list";

/**
 * The catalog reads like conference proceedings: pick a program (venue+year
 * chip) and scan a dense list, or search across everything. Browsing "all
 * 2000 papers" is not a real task, so there is no unfiltered firehose view —
 * the newest program opens by default.
 *
 * The list lives in its own component purely to keep this file readable.
 */
export default async function ConferencesPage({
  searchParams
}: {
  searchParams: Promise<{ venue?: string; year?: string; q?: string; page?: string }>;
}) {
  const user = await requireCurrentUser();
  const t = await getTranslations("conferences");
  const { venue: rawVenue, year: rawYear, q, page } = await searchParams;
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
                    <FilterLink
                      key={`${facet.venue}-${facet.year}`}
                      href={`/conferences?venue=${encodeURIComponent(facet.venue)}&year=${facet.year}`}
                      ariaCurrent={isActive}
                      className={`rounded px-2 py-0.5 text-xs tabular-nums transition-colors duration-150 ${
                        isActive
                          ? "bg-accent text-white"
                          : "bg-white text-muted ring-1 ring-inset ring-border hover:text-ink"
                      }`}
                    >
                      {facet.venue} · {facet._count._all}
                    </FilterLink>
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
        <CatalogList
          workspaceId={user.workspaceId}
          selected={selected}
          query={query}
          rawQuery={q}
          page={page}
        />
      )}
    </div>
  );
}
