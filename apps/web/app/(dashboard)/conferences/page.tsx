import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { isReadingState } from "@paper-viewer/core/paper-status";
import { requireCurrentUser } from "@/lib/auth";
import { ConferenceFilters } from "@/components/conference-filters";
import { ConferenceSyncButton } from "@/components/conference-sync-button";
import { ReadingStateChips } from "@/components/reading-state-chips";
import { SaveToLibraryButton } from "@/components/save-to-library-button";

// Guard against a runaway catalog rendering thousands of cards at once; the
// truncation is announced in the UI, never silent.
const MAX_ENTRIES = 500;

export default async function ConferencesPage({
  searchParams
}: {
  searchParams: Promise<{ venue?: string; year?: string }>;
}) {
  const user = await requireCurrentUser();
  const t = await getTranslations("conferences");
  const tHome = await getTranslations("home");
  const { venue, year: rawYear } = await searchParams;
  const year = rawYear && /^\d{4}$/.test(rawYear) ? Number.parseInt(rawYear, 10) : undefined;

  const [facets, entries] = await Promise.all([
    prisma.conferenceEntry.findMany({
      select: { venue: true, year: true },
      distinct: ["venue", "year"],
      orderBy: [{ year: "desc" }, { venue: "asc" }]
    }),
    prisma.conferenceEntry.findMany({
      where: {
        ...(venue ? { venue } : {}),
        ...(year ? { year } : {})
      },
      orderBy: [{ year: "desc" }, { venue: "asc" }, { createdAt: "asc" }],
      take: MAX_ENTRIES + 1,
      include: {
        paper: {
          include: {
            // Present only once someone saved the paper to the library.
            workspacePapers: {
              where: { workspaceId: user.workspaceId },
              include: { readingStates: { where: { userId: user.id } } }
            }
          }
        }
      }
    })
  ]);

  const truncated = entries.length > MAX_ENTRIES;
  const visibleEntries = truncated ? entries.slice(0, MAX_ENTRIES) : entries;

  const venueOptions = [...new Set(facets.map((facet) => facet.venue))].sort();
  const yearOptions = [...new Set(facets.map((facet) => facet.year))];

  // One section per venue+year program, newest year first (query order).
  const sections: { key: string; venue: string; year: number; items: typeof visibleEntries }[] = [];
  for (const entry of visibleEntries) {
    const last = sections[sections.length - 1];
    if (last && last.venue === entry.venue && last.year === entry.year) {
      last.items.push(entry);
    } else {
      sections.push({ key: `${entry.venue}-${entry.year}`, venue: entry.venue, year: entry.year, items: [entry] });
    }
  }

  const canSync = canManageWorkspaceSettings(user.role);
  const hasFilters = Boolean(venue || year);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <div className="flex items-center gap-3">
          {facets.length > 0 ? (
            <span className="text-xs text-muted tabular-nums">
              {t("count", { count: visibleEntries.length })}
            </span>
          ) : null}
          {hasFilters ? (
            <Link className="text-xs text-accent hover:underline" href="/conferences">
              {t("clearFilters")}
            </Link>
          ) : null}
          {facets.length > 0 ? <ConferenceFilters venues={venueOptions} years={yearOptions} /> : null}
          {canSync ? <ConferenceSyncButton /> : null}
        </div>
      </div>

      {sections.length === 0 ? (
        // Filtered-empty and truly-empty are different situations: one needs
        // an exit from the filters, the other an explanation of the feature.
        hasFilters ? (
          <div className="flex flex-col items-center gap-3 rounded border border-border bg-white shadow-card px-6 py-16 text-center">
            <p className="text-sm text-muted">{t("emptyFiltered")}</p>
            <Link className="text-sm text-accent hover:underline" href="/conferences">
              {t("clearFilters")}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded border border-border bg-white shadow-card px-6 py-16 text-center">
            <h2 className="text-lg font-semibold">{t("emptyTitle")}</h2>
            <p className="max-w-md text-sm leading-relaxed text-muted">
              {canSync ? t("emptyBodyAdmin") : t("emptyBody")}
            </p>
          </div>
        )
      ) : null}

      {truncated ? (
        <p className="rounded border border-border bg-surface px-4 py-2 text-sm text-muted">
          {t("truncatedNotice", { max: MAX_ENTRIES })}
        </p>
      ) : null}

      {sections.map((section) => (
        <section key={section.key} className="space-y-3">
          <div className="flex items-baseline justify-between rounded border border-border bg-white shadow-card px-5 py-3">
            <h2 className="text-sm font-semibold uppercase text-muted">
              {section.venue} {section.year}
            </h2>
            <span className="text-xs text-muted">{t("count", { count: section.items.length })}</span>
          </div>

          {section.items.map((entry) => {
            const paper = entry.paper;
            const workspacePaper = paper.workspacePapers[0];
            const readingState = workspacePaper?.readingStates[0]?.state ?? "new";

            return (
              <div
                key={entry.id}
                className="rounded border border-border bg-white shadow-card p-5 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-raised"
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Only the content column links out, so the actions on the
                      right stay clickable without nesting buttons in an <a>. */}
                  <Link href={`/papers/${paper.id}`} className="min-w-0 flex-1">
                    <h3 className="font-semibold">{paper.title}</h3>
                    <p className="mt-1 text-sm text-muted">
                      {Array.isArray(paper.authors) ? (paper.authors as string[]).join(", ") : ""}
                    </p>
                    {paper.abstract ? (
                      <p className="mt-3 line-clamp-3 text-sm">{paper.abstract}</p>
                    ) : null}
                  </Link>
                  <div className="flex flex-col items-end gap-2">
                    {workspacePaper ? (
                      <>
                        <span className="rounded bg-surface px-2 py-0.5 text-xs text-muted">
                          {tHome("savedBadge")}
                        </span>
                        <ReadingStateChips
                          paperId={paper.id}
                          state={isReadingState(readingState) ? readingState : "new"}
                        />
                      </>
                    ) : (
                      <SaveToLibraryButton paperId={paper.id} />
                    )}
                    {paper.arxivId ? (
                      <span className="text-xs text-muted">arXiv:{paper.arxivId}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
