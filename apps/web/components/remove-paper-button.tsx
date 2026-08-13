"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { toast } from "./toast";

/**
 * Archives a paper out of the library, from the paper's own page — the action
 * lives next to the paper you are actually reading rather than on a dense list
 * row, where a mis-aimed click used to archive the wrong article. Rendering is
 * admin-gated by the caller and the API enforces the same rule.
 */
export function RemovePaperButton({ paperId, paperTitle }: { paperId: string; paperTitle: string }) {
  const t = useTranslations("workspace");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleRemove() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/papers/${paperId}/remove`, { method: "POST" });
      if (!response.ok) {
        toast.error(t("removeFailed"));
        return;
      }
      // This page no longer has a library row behind it, so staying put would
      // fall through to the read-only preview (or a 404).
      router.push("/library");
      router.refresh();
    } catch {
      toast.error(t("removeFailed"));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <button
        className="rounded border border-border px-2 py-1 text-xs text-muted transition-colors duration-150 hover:border-danger-border hover:text-danger"
        onClick={() => setConfirming(true)}
        type="button"
      >
        {t("remove")}
      </button>
      <ConfirmDialog
        open={confirming}
        message={t("removeDialogMessage", { title: paperTitle })}
        confirmLabel={t("remove")}
        destructive
        busy={busy}
        onConfirm={() => void handleRemove()}
        onCancel={() => {
          if (!busy) setConfirming(false);
        }}
      />
    </>
  );
}
