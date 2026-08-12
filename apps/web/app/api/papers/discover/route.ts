import { requireCurrentUser } from "@/lib/auth";
import { runDailyDigest } from "@/lib/daily-digest";

export const maxDuration = 300;

/** Leaves 50s of headroom for generating the overview and pushing to Feishu, so the run does not hit maxDuration and get cut off. */
const RUN_BUDGET_MS = 250_000;

export async function POST() {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const result = await runDailyDigest(user.workspaceId, { deadline: Date.now() + RUN_BUDGET_MS });
  const date = new Date().toISOString().slice(0, 10);

  switch (result.status) {
    case "done":
    case "partial":
      return Response.json({
        ok: true,
        date,
        status: result.status,
        discovered: result.processed,
        remaining: result.remaining
      });
    case "skipped_no_new":
      return Response.json({ ok: true, date, discovered: 0, message: "今日无新论文" });
    case "skipped_done":
      return Response.json({ ok: true, date, alreadyDone: true });
    // The scheduled job (or another browser tab) is running today's digest; this
    // is not an error, the frontend just needs to refresh
    case "locked":
      return Response.json({ ok: true, date, running: true });
    default:
      return Response.json({ error: result.message ?? "Daily digest failed" }, { status: 500 });
  }
}
