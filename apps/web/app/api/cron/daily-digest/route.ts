/**
 * Vercel Cron entry point: runs the daily digest serially for every workspace that
 * has research preferences configured.
 *
 * When the CRON_SECRET environment variable exists, Vercel automatically attaches
 * `Authorization: Bearer $CRON_SECRET`, so no extra signing mechanism is needed
 * here; with no secret configured the whole endpoint 404s (off by default locally,
 * so it is never left exposed).
 * See vercel.json for the schedule: twice on weekdays, at 13:00 and 13:30 Beijing
 * time, with the second run responsible for resuming the previous run's partial.
 * Both sit after arXiv's daily 04:00 UTC (12:00 Beijing) RSS rebuild — see
 * DEFAULT_PUSH_HOUR for why running before it reads a stale, and on Mondays an
 * empty, feed.
 *
 * A workspace can pick its own push hour (ResearchPreferences.pushHour, in Beijing
 * time); a workspace whose hour has not arrived is recorded as not_due and skipped
 * for this pass. Note that this is only a gate — the real trigger frequency
 * depends on the schedule: with the two fixed cron runs currently in vercel.json,
 * only workspaces with pushHour <= 13 are let through by that day's 13:00 run.
 * Later hours require either Vercel Pro's hourly cron or an external scheduler
 * (such as GitHub Actions) hitting this endpoint every hour — that is a
 * deployment-side decision, and all this code guarantees is that the due check
 * itself is correct.
 */

import { prisma } from "@paper-viewer/db";
import { timingSafeEqual } from "node:crypto";
import { runDailyDigest, type DigestRunStatus } from "@/lib/daily-digest";
import { getEnv } from "@/lib/env";
import { isDueForPush } from "@/lib/push-schedule";
import { rotateForDay } from "@/lib/workspace-rotation";

export const maxDuration = 300;

/** Leaves 50s of headroom for wrap-up so the run does not hit maxDuration and get cut off. All workspaces share this budget. */
const RUN_BUDGET_MS = 250_000;

type WorkspaceResult = {
  workspaceId: string;
  /**
   * A workspace whose turn never came before the budget ran out is recorded as
   * deferred and waits for the next scheduled run; one whose configured pushHour
   * has not yet arrived in Beijing time is recorded as not_due and consumes none
   * of this pass's budget at all.
   */
  status: DigestRunStatus | "deferred" | "not_due";
  processed: number;
  remaining: number;
  message?: string;
};

function isAuthorized(request: Request, secret: string): boolean {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return false;
  }
  const token = Buffer.from(auth.slice(7));
  const expected = Buffer.from(secret);
  if (token.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(token, expected);
}

/**
 * A targeted debugging parameter that only takes effect outside production:
 * `?workspaceId=<id>` restricts this pass to a single workspace.
 * It is used locally to verify the whole chain against a test workspace without
 * incidentally burning a real workspace's quota for the day.
 * In production (including any deployment on Vercel other than preview) it is
 * always ignored.
 */
function devWorkspaceFilter(request: Request): string | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }
  return new URL(request.url).searchParams.get("workspaceId");
}

export async function GET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    return new Response("Not Found", { status: 404 });
  }
  if (!isAuthorized(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // One clock for the whole pass: the due check and the day's rotation see the
  // same "now".
  const now = new Date();
  const deadline = Date.now() + RUN_BUDGET_MS;
  const onlyWorkspaceId = devWorkspaceFilter(request);
  const allWorkspaces = await prisma.researchPreferences.findMany({
    ...(onlyWorkspaceId ? { where: { workspaceId: onlyWorkspaceId } } : {}),
    select: { workspaceId: true, pushHour: true },
    orderBy: { workspaceId: "asc" }
  });
  // Ascending workspaceId is only a stable baseline; the actual execution order
  // is rotated daily, otherwise whenever the budget falls short it would always
  // be the same few workspaces at the tail that get deferred.
  const workspaces = rotateForDay(allWorkspaces, now);

  const results: WorkspaceResult[] = [];
  for (const { workspaceId, pushHour } of workspaces) {
    if (!isDueForPush(pushHour, now)) {
      results.push({ workspaceId, status: "not_due", processed: 0, remaining: 0 });
      continue;
    }
    if (Date.now() > deadline) {
      results.push({ workspaceId, status: "deferred", processed: 0, remaining: 0 });
      continue;
    }
    const result = await runDailyDigest(workspaceId, { deadline });
    results.push({
      workspaceId,
      status: result.status,
      processed: result.processed,
      remaining: result.remaining,
      ...(result.message ? { message: result.message } : {})
    });
  }

  return Response.json({ ok: true, ranAt: new Date().toISOString(), results });
}
