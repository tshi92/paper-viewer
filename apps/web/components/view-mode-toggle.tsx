"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { VIEW_MODE_COOKIE, type ViewMode } from "@/lib/view-mode";

/**
 * The team/personal lens, as a two-state segmented control. The choice lives
 * in a cookie rather than component state because the pages that honour it
 * (library, paper workspace) filter on the server — flipping it re-renders the
 * page through router.refresh().
 */
export function ViewModeToggle({ current }: { current: ViewMode }) {
  const t = useTranslations("viewMode");
  const router = useRouter();
  // Mirrors the cookie so the control answers instantly while the refresh runs.
  const [mode, setMode] = useState<ViewMode>(current);

  function switchTo(next: ViewMode) {
    if (next === mode) return;
    setMode(next);
    document.cookie = `${VIEW_MODE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  const base = "rounded-full px-3 py-1 text-xs font-medium transition-colors";

  return (
    <div
      className="flex items-center gap-0.5 rounded-full border border-border bg-surface p-0.5"
      role="group"
      aria-label={t("label")}
      data-testid="view-mode-toggle"
    >
      <button
        className={`${base} ${mode === "team" ? "bg-white shadow-card" : "text-muted"}`}
        aria-pressed={mode === "team"}
        onClick={() => switchTo("team")}
        type="button"
      >
        {t("team")}
      </button>
      <button
        className={`${base} ${mode === "mine" ? "bg-white shadow-card" : "text-muted"}`}
        aria-pressed={mode === "mine"}
        onClick={() => switchTo("mine")}
        type="button"
      >
        {t("mine")}
      </button>
    </div>
  );
}
