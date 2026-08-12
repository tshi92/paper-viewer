"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

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
  const [notice, setNotice] = useState<{ kind: "error" | "done"; text: string } | null>(null);

  async function sync() {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await fetch("/api/conferences/sync", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        entries?: number;
        createdPapers?: number;
      };
      if (!response.ok) {
        setNotice({
          kind: "error",
          text: body.error === "source_not_configured" ? t("syncNotConfigured") : t("syncFailed")
        });
        return;
      }
      setNotice({
        kind: "done",
        text: t("syncDone", { entries: body.entries ?? 0, created: body.createdPapers ?? 0 })
      });
      router.refresh();
    } catch {
      setNotice({ kind: "error", text: t("syncFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="rounded border border-border px-3 py-2 text-sm disabled:opacity-50"
        onClick={() => void sync()}
        disabled={busy}
      >
        {busy ? t("syncing") : t("sync")}
      </button>
      {notice ? (
        <span role={notice.kind === "error" ? "alert" : "status"} className={`text-xs ${notice.kind === "error" ? "text-danger" : "text-muted"}`}>
          {notice.text}
        </span>
      ) : null}
    </span>
  );
}
