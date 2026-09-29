import { ensureMonthlyIssue, type IssueResult } from "@/lib/researcher-digest";
import {
  classifyPendingPapers, syncResearchers, type ClassifyResult, type ResearcherSyncResult
} from "@/lib/researcher-sync";

/**
 * One run of the Researchers pipeline, and the only copy of it: the daily
 * cron passes every workspace, the admin sync button only the caller's.
 *   1. sync data/researchers.json — two reads when the file adds nothing;
 *   2. per workspace, classify its window papers with its own LLM — one read
 *      when none are pending;
 *   3. then, only once none are left, this month's issue — one findUnique
 *      once sealed.
 * A failed step is recorded and the run goes on: a failed fetch leaves the
 * stored data, which is still worth refreshing, and one workspace's failure
 * does not stop the next. Every write is idempotent, so a button press that
 * overlaps the cron costs duplicate LLM calls, never duplicate rows.
 */

/** Both routes set maxDuration = 300; this leaves 50s of headroom, as in the daily-digest cron. */
const RUN_BUDGET_MS = 250_000;

export type WorkspaceRun = {
  workspaceId: string;
  /** Absent when the budget ran out before this workspace, or it failed. */
  classify?: ClassifyResult;
  issue: IssueResult | { status: "error"; message: string };
};

export type ResearchersRun = {
  ranAt: string;
  sync: ResearcherSyncResult | { error: string };
  workspaces: WorkspaceRun[];
};

export async function runResearchers(workspaceIds: readonly string[]): Promise<ResearchersRun> {
  const now = new Date();
  const deadline = Date.now() + RUN_BUDGET_MS;

  let sync: ResearchersRun["sync"];
  try {
    sync = await syncResearchers();
  } catch (error) {
    console.error("[researchers] sync failed", error);
    sync = { error: messageOf(error) };
  }

  const workspaces: WorkspaceRun[] = [];
  for (const workspaceId of workspaceIds) {
    if (Date.now() > deadline) {
      // The next run picks this workspace up.
      workspaces.push({ workspaceId, issue: { status: "deferred" } });
      continue;
    }
    try {
      const classify = await classifyPendingPapers(workspaceId, now, deadline);
      // An issue is sealed for the month: never write one over papers still
      // waiting for a direction. The next run classifies the rest and retries.
      const issue: IssueResult =
        classify.remaining > 0 ? { status: "deferred" } : await ensureMonthlyIssue(workspaceId, now, deadline);
      workspaces.push({ workspaceId, classify, issue });
    } catch (error) {
      console.error("[researchers] workspace failed", workspaceId, error);
      workspaces.push({ workspaceId, issue: { status: "error", message: messageOf(error) } });
    }
  }
  return { ranAt: now.toISOString(), sync, workspaces };
}

function messageOf(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 200);
}
