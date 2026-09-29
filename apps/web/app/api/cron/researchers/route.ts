/**
 * Vercel Cron entry for the Researchers page: daily at 00:00 UTC (vercel.json),
 * which is 08:00 Beijing. Hobby fires anywhere within that hour, so a month's
 * issue (months turn over in UTC) is written within an hour of the month
 * starting, and the run lands between 08:00 and 08:59 Beijing, outside every
 * Today digest trigger (the 05:00/05:30 UTC crons and the GitHub workflow's
 * 03:50–14:50 UTC dispatches): the two pipelines never run at the same time.
 *
 * csconf-papers republishes data/researchers.json every other Monday. There is
 * deliberately no every-other-Monday gate here: each step is idempotent and
 * cheap when idle, so a daily run picks a publish up the next morning. The run
 * itself is lib/researcher-run.ts, shared with the admin sync button. Same auth
 * and 404-without-secret behaviour as /api/cron/daily-digest.
 */

import { prisma } from "@paper-viewer/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { getEnv } from "@/lib/env";
import { runResearchers } from "@/lib/researcher-run";

// lib/researcher-run.ts budgets the run to leave 50s of headroom under this.
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = getEnv().CRON_SECRET;
  if (!secret) {
    return new Response("Not Found", { status: 404 });
  }
  if (!isCronAuthorized(request, secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Every workspace, not every ResearchPreferences row: that table has no
  // foreign key, so a deleted workspace can leave its row behind, and a run for
  // it would spend LLM calls on directions it cannot store.
  const workspaces = await prisma.workspace.findMany({ select: { id: true }, orderBy: { createdAt: "asc" } });
  return Response.json({ ok: true, ...(await runResearchers(workspaces.map((row) => row.id))) });
}
