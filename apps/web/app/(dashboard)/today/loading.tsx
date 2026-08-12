import { getTranslations } from "next-intl/server";

/** Mirrors the Today layout: page header, digest meta card, paper cards. */
export default async function TodayLoading() {
  const t = await getTranslations("common");

  return (
    <div role="status" aria-label={t("loading")} className="space-y-6">
      <div aria-hidden className="flex items-center justify-between">
        <div className="skeleton h-8 w-24" />
        <div className="flex gap-2">
          <div className="skeleton h-9 w-24" />
          <div className="skeleton h-9 w-28" />
        </div>
      </div>

      <div aria-hidden className="space-y-3">
        <div className="rounded border border-border bg-white shadow-card p-5">
          <div className="skeleton h-4 w-56" />
          <div className="mt-3 space-y-2">
            <div className="skeleton h-3.5 w-full" />
            <div className="skeleton h-3.5 w-4/5" />
          </div>
        </div>

        {[0, 1, 2].map((row) => (
          <div key={row} className="rounded border border-border bg-white shadow-card p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="skeleton h-5 w-3/4" />
                <div className="skeleton h-3.5 w-1/2" />
                <div className="skeleton h-3.5 w-full" />
                <div className="skeleton h-3.5 w-5/6" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="skeleton h-8 w-24" />
                <div className="skeleton h-3 w-20" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
