"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { LabelChip } from "./label-chip";
import type { LabelView } from "@/lib/annotation-types";

/**
 * Paper-level labels on the paper header card: the assigned labels as chips plus
 * a toggle panel over the workspace's paper-scope vocabulary. Every member may
 * edit, so the selection is applied optimistically and rolled back on failure.
 */
export function PaperLabelPicker({
  paperId,
  assigned,
  available
}: {
  paperId: string;
  assigned: LabelView[];
  available: LabelView[];
}) {
  const t = useTranslations("paperLabels");
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>(() => assigned.map((label) => label.id));
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);

  const selectedLabels = available.filter((label) => selectedIds.includes(label.id));

  async function toggleLabel(labelId: string) {
    const previous = selectedIds;
    const next = previous.includes(labelId)
      ? previous.filter((id) => id !== labelId)
      : [...previous, labelId];

    setSelectedIds(next);
    setFailed(false);
    try {
      const response = await fetch(`/api/papers/${paperId}/labels`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelIds: next })
      });
      if (!response.ok) {
        setSelectedIds(previous);
        setFailed(true);
        return;
      }
      // Keeps the library list and any other server-rendered view in step.
      router.refresh();
    } catch {
      setSelectedIds(previous);
      setFailed(true);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted">{t("label")}</span>

      {selectedLabels.map((label) => (
        <LabelChip key={label.id} name={label.name} color={label.color} />
      ))}
      {/* When the workspace has no paper labels at all, the hint below already
          says so — a bare "none" in front of it just reads as noise. */}
      {selectedLabels.length === 0 && available.length > 0 ? (
        <span className="text-xs text-muted">{t("none")}</span>
      ) : null}

      {available.length > 0 ? (
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface"
        >
          {open ? t("close") : t("add")}
        </button>
      ) : (
        <span className="text-xs text-muted">
          {t("empty")}{" "}
          <Link className="text-accent hover:underline" href="/settings/labels">
            {t("manage")}
          </Link>
        </span>
      )}

      {open && available.length > 0 ? (
        <div className="mt-1 flex w-full flex-wrap items-center gap-1 rounded border border-border bg-surface px-2 py-1.5">
          {available.map((label) => (
            <button key={label.id} type="button" onClick={() => void toggleLabel(label.id)} className="rounded">
              <LabelChip
                name={label.name}
                color={label.color}
                dimmed={!selectedIds.includes(label.id)}
              />
            </button>
          ))}
          <Link className="ml-auto text-[11px] text-accent hover:underline" href="/settings/labels">
            {t("manage")}
          </Link>
        </div>
      ) : null}

      {failed ? (
        <span role="alert" className="text-xs text-red-600">
          {t("saveFailed")}
        </span>
      ) : null}
    </div>
  );
}
