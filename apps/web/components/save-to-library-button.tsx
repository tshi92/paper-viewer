"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/toast";

/**
 * The explicit act that turns a digest/conference paper into a library entry.
 * After a successful save the server re-render swaps the read-only preview for
 * the full workspace, so the button stays busy until it unmounts. When the
 * server reports the article already lives in the library under another Paper
 * row, the button is replaced by a pointer to that entry instead.
 */
export function SaveToLibraryButton({ paperId }: { paperId: string }) {
  const t = useTranslations("preview");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/papers/${paperId}/save`, { method: "POST" });
      if (!response.ok) throw new Error("save failed");
      const result = (await response.json()) as { saved: boolean; duplicate?: boolean; existingPaperId?: string };
      if (result.duplicate && result.existingPaperId) {
        setDuplicateOf(result.existingPaperId);
        setBusy(false);
        return;
      }
      toast.success(t("saveDone"));
      router.refresh();
    } catch {
      toast.error(t("saveFailed"));
      setBusy(false);
    }
  }

  if (duplicateOf) {
    return (
      <span role="alert" className="inline-flex items-center gap-2 text-xs text-muted">
        {t("duplicateInLibrary")}
        <Link className="text-accent underline" href={`/papers/${duplicateOf}`}>
          {t("duplicateView")}
        </Link>
      </span>
    );
  }

  return (
    <button
      type="button"
      className="rounded bg-accent transition-transform duration-150 active:scale-[0.98] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      onClick={() => void save()}
      disabled={busy}
    >
      {busy ? t("saving") : t("saveToLibrary")}
    </button>
  );
}
