"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const DEBOUNCE_MS = 300;

/**
 * Keyword search box: a controlled input with a 300ms debounce that writes
 * the keyword back into `?q=` on `basePath` (Library by default; the
 * conference catalog reuses it). All other query parameters are preserved,
 * so search stacks with the page's filters.
 *
 * IME composition is handled explicitly: while the user is composing (Chinese
 * pinyin, Japanese, …) nothing may be written to the URL and nothing may flow
 * back from the URL into the input — a mid-composition rerender/overwrite
 * breaks the composition and commits stray characters (a trailing space on
 * confirm-with-Enter was the reported symptom).
 */
export function LibrarySearch({ basePath = "/library" }: { basePath?: string }) {
  const t = useTranslations("library");
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryParam = searchParams.get("q") ?? "";
  const [value, setValue] = useState(queryParam);
  const inputRef = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  // Bumped when a composition commits, so the debounce effect below re-runs
  // even though `value` itself did not change again.
  const [compositionTick, setCompositionTick] = useState(0);

  // Changes on the URL side (back/forward, clearing filters) flow back into
  // the input — but never while the user is typing in it: our own debounced
  // replace() also lands here, and overwriting the input mid-typing (worse,
  // mid-composition) destroys IME state.
  useEffect(() => {
    if (composing.current) return;
    if (document.activeElement === inputRef.current) return;
    setValue(queryParam);
  }, [queryParam]);

  useEffect(() => {
    if (composing.current) return;
    if (value === queryParam) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (value) {
        params.set("q", value);
      } else {
        params.delete("q");
      }
      const qs = params.toString();
      router.replace(`${basePath}${qs ? `?${qs}` : ""}`, { scroll: false });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, queryParam, searchParams, router, basePath, compositionTick]);

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
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          setValue(event.currentTarget.value);
          setCompositionTick((tick) => tick + 1);
        }}
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
