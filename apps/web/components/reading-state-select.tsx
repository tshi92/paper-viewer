"use client";

import { useTranslations } from "next-intl";
import { readingStates, type ReadingState } from "@paper-viewer/core/paper-status";

export function ReadingStateSelect({ paperId, state }: { paperId: string; state: ReadingState }) {
  const t = useTranslations("readingState");

  return (
    <form action={`/api/papers/${paperId}/reading-state`} method="post">
      <label className="text-xs font-medium uppercase text-muted" htmlFor="state">
        {t("label")}
      </label>
      <div className="mt-1 flex gap-2">
        <select className="w-full rounded border border-border px-3 py-2" id="state" name="state" defaultValue={state}>
          {/* The value stays the raw enum the API expects; only the label is translated. */}
          {readingStates.map((readingState) => (
            <option key={readingState} value={readingState}>
              {t(readingState)}
            </option>
          ))}
        </select>
        <button className="rounded border border-border px-3 py-2 text-sm" type="submit">
          {t("save")}
        </button>
      </div>
    </form>
  );
}
