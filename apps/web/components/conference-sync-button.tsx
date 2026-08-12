"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/toast";

/**
 * Admin/owner action that pulls the conference catalog from the configured
 * repo. Failure states distinguish "the source URL is still a placeholder"
 * from a real sync error, since the former is expected until the repo link
 * is provided.
 */
export function ConferenceSyncButton() {
  const t = useTranslations("conferences");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function sync() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/conferences/sync", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        entries?: number;
        createdPapers?: number;
      };
      if (!response.ok) {
        // The admin-only route reports the concrete failure; show it so the
        // admin can act instead of blindly retrying.
        const message =
          body.error === "source_not_configured"
            ? t("syncNotConfigured")
            : body.detail
              ? `${t("syncFailed")} (${body.detail})`
              : t("syncFailed");
        toast.error(message);
        return;
      }
      toast.success(t("syncDone", { entries: body.entries ?? 0, created: body.createdPapers ?? 0 }));
      router.refresh();
    } catch {
      toast.error(t("syncFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="rounded border border-border px-3 py-2 text-sm transition-colors duration-150 hover:bg-surface disabled:opacity-50"
      onClick={() => void sync()}
      disabled={busy}
    >
      {busy ? t("syncing") : t("sync")}
    </button>
  );
}
