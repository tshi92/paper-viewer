/**
 * Vercel Cron 入口：把所有配置了研究偏好的 workspace 串行跑一遍每日 digest。
 *
 * Vercel 在 CRON_SECRET 环境变量存在时会自动带上 `Authorization: Bearer $CRON_SECRET`，
 * 所以这里不需要额外的签名机制；没配 secret 就整个端点 404（本地默认关闭，避免裸奔）。
 * 排程见 vercel.json：工作日北京时间 9:00 / 9:30 各一次，第二次负责续跑上一次的 partial。
 *
 * workspace 可以自选推送钟点（ResearchPreferences.pushHour，北京时间），没到点的这轮记
 * not_due 跳过。注意这只是闸门，真正的触发频率取决于排程：照 vercel.json 现在这两班固定
 * cron，只有 pushHour <= 9 的 workspace 会在当天 9:00 那班被放行，更晚的钟点要么上 Vercel
 * Pro 的整点 cron，要么挂一个每小时打这个端点的外部调度（如 GitHub Actions）——属于部署侧
 * 决策，这里只保证到点判定正确。
 */

import { prisma } from "@paper-viewer/db";
import { timingSafeEqual } from "node:crypto";
import { runDailyDigest, type DigestRunStatus } from "@/lib/daily-digest";
import { getEnv } from "@/lib/env";
import { isDueForPush } from "@/lib/push-schedule";
import { rotateForDay } from "@/lib/workspace-rotation";

export const maxDuration = 300;

/** 留 50s 余量给收尾，避免踩到 maxDuration 被硬砍。所有 workspace 共享这份预算。 */
const RUN_BUDGET_MS = 250_000;

type WorkspaceResult = {
  workspaceId: string;
  /**
   * 预算耗尽后没轮到的 workspace 记 deferred，等下一次排程接着跑；
   * 北京时间还没到它配置的 pushHour 的记 not_due，本轮完全不消耗额度。
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
 * 仅非生产环境生效的定向调试参数：`?workspaceId=<id>` 把这一轮限制到单个 workspace。
 * 用于本地对着测试 workspace 验证整条链路，避免顺带跑掉真实 workspace 的当日额度。
 * 生产环境（含 Vercel 上的 preview 以外的部署）一律忽略。
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

  // 整轮共用一个时钟：到点判定和当天旋转看到的是同一个「现在」。
  const now = new Date();
  const deadline = Date.now() + RUN_BUDGET_MS;
  const onlyWorkspaceId = devWorkspaceFilter(request);
  const allWorkspaces = await prisma.researchPreferences.findMany({
    ...(onlyWorkspaceId ? { where: { workspaceId: onlyWorkspaceId } } : {}),
    select: { workspaceId: true, pushHour: true },
    orderBy: { workspaceId: "asc" }
  });
  // workspaceId 升序只是稳定基准；真正的执行顺序每天旋转，
  // 否则预算不够时永远是同几个尾部 workspace 被 deferred。
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
