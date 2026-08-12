"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Venue/year narrowing for the conference catalog. State lives in the URL so
 * filtered views are shareable and survive refreshes; changing a select
 * replaces the query string in place.
 */
export function ConferenceFilters({ venues, years }: { venues: string[]; years: number[] }) {
  const t = useTranslations("conferences");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: "venue" | "year", value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  const selectClass = "rounded border border-control bg-white px-2 py-1 text-sm";

  return (
    <div className="flex items-center gap-2">
      <select
        aria-label={t("venueFilterAria")}
        className={selectClass}
        onChange={(event) => updateParam("venue", event.target.value)}
        value={searchParams.get("venue") ?? ""}
      >
        <option value="">{t("allVenues")}</option>
        {venues.map((venue) => (
          <option key={venue} value={venue}>
            {venue}
          </option>
        ))}
      </select>
      <select
        aria-label={t("yearFilterAria")}
        className={selectClass}
        onChange={(event) => updateParam("year", event.target.value)}
        value={searchParams.get("year") ?? ""}
      >
        <option value="">{t("allYears")}</option>
        {years.map((year) => (
          <option key={year} value={String(year)}>
            {year}
          </option>
        ))}
      </select>
    </div>
  );
}
