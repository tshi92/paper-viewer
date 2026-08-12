import { getTranslations } from "next-intl/server";

/** Mirrors the Library layout: one section card with header, filter row, paper rows. */
export default async function LibraryLoading() {
  const t = await getTranslations("common");

  return (
    <section role="status" aria-label={t("loading")} className="rounded border border-border bg-white shadow-card">
      <div aria-hidden className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="skeleton h-6 w-20" />
        <div className="skeleton h-8 w-24" />
      </div>

      <div aria-hidden className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <div className="skeleton h-7 w-28" />
        <div className="skeleton h-7 w-28" />
        <div className="skeleton h-7 w-32" />
        <div className="skeleton h-7 w-40" />
      </div>

      <div aria-hidden className="divide-y divide-border">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="flex items-center justify-between px-4 py-4">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton h-[1.125rem] w-2/3" />
              <div className="skeleton h-3.5 w-2/5" />
            </div>
            <div className="skeleton ml-4 h-7 w-40 shrink-0" />
          </div>
        ))}
      </div>
    </section>
  );
}
