import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { maskWebhookUrl } from "@paper-viewer/core/notify";
import { buildTestCard, sendFeishuCard } from "@/lib/feishu";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";

type NotificationView = {
  configured: boolean;
  feishuWebhookMasked: string;
};

/**
 * `feishuWebhookUrl` 三态：缺省=保持不变，空串=清除，非空=校验后保存。
 * 因此这里只能用 `.optional()`，不能给默认值。
 */
const updateSchema = z.object({
  feishuWebhookUrl: z.string().max(500).optional()
});

const testSchema = z.object({
  feishuWebhookUrl: z.string().max(500).optional()
});

async function resolveCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await requireCurrentUser();
  } catch {
    return null;
  }
}

function toView(webhookUrl: string | null | undefined): NotificationView {
  const url = webhookUrl ?? "";
  return { configured: Boolean(url), feishuWebhookMasked: maskWebhookUrl(url) };
}

async function loadWebhookUrl(workspaceId: string): Promise<string | null> {
  const row = await prisma.researchPreferences.findUnique({ where: { workspaceId } });
  return row?.feishuWebhookUrl ?? null;
}

/** 401/403 统一入口：返回 CurrentUser 或应当直接回给客户端的 Response。 */
async function authorize(): Promise<CurrentUser | Response> {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!canManageWorkspaceSettings(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return user;
}

export async function GET() {
  const auth = await authorize();
  if (auth instanceof Response) return auth;

  return Response.json(toView(await loadWebhookUrl(auth.workspaceId)));
}

export async function PUT(request: Request) {
  const auth = await authorize();
  if (auth instanceof Response) return auth;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "请求格式不正确" }, { status: 400 });
  }

  const raw = parsed.data.feishuWebhookUrl;

  // 缺省：保持不变。
  if (raw === undefined) {
    return Response.json(toView(await loadWebhookUrl(auth.workspaceId)));
  }

  const webhookUrl = raw.trim();

  // 空串：清除。用 updateMany 以免为没有偏好行的工作区凭空建行。
  if (!webhookUrl) {
    await prisma.researchPreferences.updateMany({
      where: { workspaceId: auth.workspaceId },
      data: { feishuWebhookUrl: null }
    });
    return Response.json(toView(null));
  }

  if (!z.string().url().safeParse(webhookUrl).success || !webhookUrl.startsWith("https://")) {
    return Response.json({ error: "Webhook 必须是 https 地址" }, { status: 400 });
  }

  const row = await prisma.researchPreferences.upsert({
    where: { workspaceId: auth.workspaceId },
    update: { feishuWebhookUrl: webhookUrl },
    create: { workspaceId: auth.workspaceId, feishuWebhookUrl: webhookUrl }
  });
  return Response.json(toView(row.feishuWebhookUrl));
}

/** 只发测试卡片，不落库；请求体里的地址原样使用，方便保存前先试。 */
export async function POST(request: Request) {
  const auth = await authorize();
  if (auth instanceof Response) return auth;

  const parsed = testSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "请求格式不正确" }, { status: 400 });
  }

  const webhookUrl =
    parsed.data.feishuWebhookUrl?.trim() || (await loadWebhookUrl(auth.workspaceId)) || "";
  if (!webhookUrl) {
    return Response.json({ ok: false, message: "未配置 webhook" });
  }

  const ok = await sendFeishuCard(webhookUrl, buildTestCard());
  return Response.json({ ok });
}
