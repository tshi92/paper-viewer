"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const DEBOUNCE_MS = 300;

/**
 * Library search box: a controlled input with a 300ms debounce that writes the
 * keyword back into `?q=`.
 * The remaining query parameters (time / tag) are preserved as they are, so search
 * stacks with the time and topic filters.
 */
export function LibrarySearch() {
  const t = useTranslations("library");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryParam = searchParams.get("q") ?? "";
  const [value, setValue] = useState(queryParam);

  // Changes on the URL side (back/forward, clearing filters) flow back into the
  // input.
  useEffect(() => {
    setValue(queryParam);
  }, [queryParam]);

  useEffect(() => {
    if (value === queryParam) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      const qs = params.toString();
      router.replace(`/library${qs ? `?${qs}` : ""}`, { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, queryParam, searchParams, router]);

  return (
    <div className="relative ml-auto">
      <svg
        aria-hidden
        viewBox="0 0 16 16"
        className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      >
        <circle cx="7" cy="7" r="4.5" />
        <path d="m10.5 10.5 3 3" />
      </svg>
      <input
        // text rather than search, so WebKit's native clear button does not duplicate the ✕ below
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchPlaceholder")}
        className="w-56 rounded border border-control bg-white py-1 pl-7 pr-6 text-xs placeholder:text-muted focus:border-accent"
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue("")}
          aria-label={t("searchClear")}
          title={t("searchClear")}
          className="absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-muted hover:bg-surface"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
