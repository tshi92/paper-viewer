"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readingStates, type ReadingState } from "@paper-viewer/core/paper-status";

/**
 * Inline segmented control for the viewer's reading state: click marks the
 * paper right where it is listed — no page load, no separate save button. The
 * chip flips optimistically and rolls back if the write fails.
 */
export function ReadingStateChips({
  paperId,
  state,
  showLabel = false
}: {
  paperId: string;
  state: ReadingState;
  showLabel?: boolean;
}) {
  const t = useTranslations("readingState");
  const router = useRouter();
  const [current, setCurrent] = useState<ReadingState>(state);
  const [failed, setFailed] = useState(false);

  async function mark(next: ReadingState) {
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    setFailed(false);
    try {
      const res = await fetch(`/api/papers/${paperId}/reading-state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next })
      });
      if (!res.ok) throw new Error("reading state update failed");
      // Server components elsewhere on the page (Today ordering, Library
      // filters) re-read the new state on the refresh.
      router.refresh();
    } catch {
      setCurrent(previous);
      setFailed(true);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {showLabel ? (
        <span className="text-xs font-medium uppercase text-muted">{t("label")}</span>
      ) : null}
      <div
        role="radiogroup"
        aria-label={t("label")}
        className="flex items-center gap-0.5 rounded border border-border bg-white p-0.5"
        data-testid="reading-state-chips"
      >
        {readingStates.map((readingState) => (
          <button
            key={readingState}
            type="button"
            role="radio"
            aria-checked={readingState === current}
            className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] ${
              readingState === current ? "bg-accent text-white" : "text-muted hover:bg-surface"
            }`}
            onClick={() => void mark(readingState)}
          >
            {t(readingState)}
          </button>
        ))}
      </div>
      {failed ? <span className="text-xs text-danger">{t("saveFailed")}</span> : null}
    </div>
  );
}
