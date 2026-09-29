"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/toast";
import type { ResearchersRun } from "@/lib/researcher-run";

/** The first step of the run that failed, in the order the run takes them. */
function firstFailure(run: Partial<ResearchersRun>): string | undefined {
  if (run.sync && "error" in run.sync) return run.sync.error;
  const issue = run.workspaces?.[0]?.issue;
  if (issue && "message" in issue) return issue.message;
  return issue?.status === "failed" ? issue.errors?.[0] : undefined;
}

/**
 * Admin/owner action: the daily Researchers run on demand, for this workspace
 * (POST /api/researchers/sync). The run goes on past a failed step, so a
 * successful response can still carry a failure; the first one is shown.
 * Styled like ConferenceSyncButton, which sits in the same spot on its page.
 */
export function ResearcherSyncButton() {
  const t = useTranslations("researchers");
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function sync() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/researchers/sync", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as Partial<ResearchersRun> & { error?: string };
      if (!response.ok) {
        toast.error(t("syncFailed", { detail: body.error ?? String(response.status) }));
        return;
      }
      const detail = firstFailure(body);
      const own = body.workspaces?.[0];
      if (detail) {
        toast.error(t("syncFailed", { detail }));
      } else {
        const sync = body.sync && !("error" in body.sync) ? body.sync : undefined;
        toast.success(t("syncDone", { papers: sync?.newPapers ?? 0, classified: own?.classify?.classified ?? 0 }));
        // The first run of a window can spend the whole budget classifying;
        // the issue is then written by the next run, which this says to start.
        if (own?.issue.status === "deferred") toast.info(t("syncDeferred"));
      }
      // Even a partly failed run may have added papers or sealed the issue.
      router.refresh();
    } catch (error) {
      toast.error(t("syncFailed", { detail: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="flex h-[26px] items-center rounded border border-accent/40 px-3 text-xs font-medium text-accent transition-colors duration-150 hover:bg-accent/10 disabled:opacity-50"
      onClick={() => void sync()}
      disabled={busy}
    >
      {busy ? t("syncing") : t("sync")}
    </button>
  );
}
