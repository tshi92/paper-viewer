"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

/**
 * Uniform "back" affordance for second-level pages (paper workspace and
 * preview). Prefers real history so it returns to the exact list state the
 * user came from (filters, scroll); falls back to a sensible list page when
 * the paper was opened directly.
 */
export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const t = useTranslations("common");
  const router = useRouter();

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
          router.push(fallbackHref);
        }
      }}
    >
      ←
    </button>
  );
}
