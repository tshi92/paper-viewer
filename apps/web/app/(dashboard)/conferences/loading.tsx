import { getTranslations } from "next-intl/server";

/** Mirrors the Conferences layout: page header with filters, venue section, paper cards. */
export default async function ConferencesLoading() {
  const t = await getTranslations("common");

  return (
    <div role="status" aria-label={t("loading")} className="space-y-6">
      <div aria-hidden className="flex flex-wrap items-center justify-between gap-3">
        <div className="skeleton h-8 w-24" />
        <div className="flex items-center gap-2">
          <div className="skeleton h-8 w-28" />
          <div className="skeleton h-8 w-24" />
        </div>
      </div>

      <div aria-hidden className="space-y-3">
        <div className="flex items-center justify-between rounded border border-border bg-white shadow-card px-5 py-3">
          <div className="skeleton h-4 w-28" />
          <div className="skeleton h-3 w-12" />
        </div>

        {[0, 1, 2].map((row) => (
          <div key={row} className="rounded border border-border bg-white shadow-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="skeleton h-5 w-3/4" />
                <div className="skeleton h-3.5 w-1/2" />
                <div className="skeleton h-3.5 w-full" />
              </div>
              <div className="skeleton h-8 w-24" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
