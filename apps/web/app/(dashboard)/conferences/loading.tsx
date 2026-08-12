import { getTranslations } from "next-intl/server";

/** Mirrors the Conferences layout: header with search, chip rail, dense rows. */
export default async function ConferencesLoading() {
  const t = await getTranslations("common");

  return (
    <div role="status" aria-label={t("loading")} className="space-y-4">
      <div aria-hidden className="flex flex-wrap items-center justify-between gap-3">
        <div className="skeleton h-8 w-24" />
        <div className="flex items-center gap-3">
          <div className="skeleton h-7 w-56" />
          <div className="skeleton h-9 w-24" />
        </div>
      </div>

      <div aria-hidden className="space-y-1.5">
        {[0, 1].map((row) => (
          <div key={row} className="flex items-center gap-1.5">
            <div className="skeleton h-4 w-10" />
            {[0, 1, 2, 3, 4].map((chip) => (
              <div key={chip} className="skeleton h-5 w-20" />
            ))}
          </div>
        ))}
      </div>

      <div aria-hidden className="skeleton h-3.5 w-40" />

      <div aria-hidden className="rounded border border-border bg-white shadow-card">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex items-center justify-between gap-4 border-t border-t-border px-4 py-3 first:border-t-0">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3.5 w-1/2" />
            </div>
            <div className="skeleton h-8 w-24 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  );
}
