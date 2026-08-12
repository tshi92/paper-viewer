"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * The explicit act that turns a digest/conference paper into a library entry.
 * After a successful save the server re-render swaps the read-only preview for
 * the full workspace, so the button stays busy until it unmounts.
 */
export function SaveToLibraryButton({ paperId }: { paperId: string }) {
  const t = useTranslations("preview");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function save() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/papers/${paperId}/save`, { method: "POST" });
      if (!response.ok) throw new Error("save failed");
      router.refresh();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        onClick={() => void save()}
        disabled={busy}
      >
        {busy ? t("saving") : t("saveToLibrary")}
      </button>
      {failed ? (
        <span role="alert" className="text-xs text-danger">
          {t("saveFailed")}
        </span>
      ) : null}
    </span>
  );
}
