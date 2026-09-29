"use client";

import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { paperSectionOf } from "./top-nav";

/**
 * Uniform "back" affordance for second-level pages (paper workspace and
 * preview). Prefers real history so it returns to the exact list state the
 * user came from (filters, scroll). A paper opened without history (a new tab,
 * a pasted link) goes to the tab its ?from= names, the one the header
 * highlights, and only without one to `fallbackHref`.
 */
export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const t = useTranslations("common");
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <button
      type="button"
      aria-label={t("back")}
      title={t("back")}
      className="shrink-0 rounded border border-border px-2 py-1 text-sm text-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
      onClick={() => {
        if (window.history.length > 1) {
          router.back();
        } else {
          router.push(paperSectionOf(searchParams.get("from")) ?? fallbackHref);
        }
      }}
    >
      ←
    </button>
  );
}
