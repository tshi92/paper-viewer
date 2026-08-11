import { requireCurrentUser } from "@/lib/auth";
import { runDailyDigest } from "@/lib/daily-digest";

export const maxDuration = 300;

/** 留 50s 余量给总览生成和飞书推送，避免踩到 maxDuration 被硬砍。 */
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
    // 定时任务（或另一个标签页）正在跑今天的 digest，不是错误，让前端刷新即可
    case "locked":
      return Response.json({ ok: true, date, running: true });
    default:
      return Response.json({ error: result.message ?? "Daily digest failed" }, { status: 500 });
  }
}
