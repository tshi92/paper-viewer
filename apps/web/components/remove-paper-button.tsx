"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * Archives a paper out of the library. The dialog names the exact paper so a
 * mis-aimed click on a dense row cannot silently archive the wrong one.
 */
export function RemovePaperButton({
  workspacePaperId,
  paperTitle
}: {
  workspacePaperId: string;
  paperTitle: string;
}) {
  const t = useTranslations("library");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleRemove() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch(`/api/papers/${workspacePaperId}/remove`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <button
        className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted opacity-0 transition-colors duration-150 group-hover:opacity-100 focus-visible:opacity-100 hover:border-danger-border hover:text-danger"
        onClick={() => setConfirming(true)}
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
