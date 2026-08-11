import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { maskWebhookUrl } from "@paper-viewer/core/notify";
import { buildTestCard, sendFeishuCard } from "@/lib/feishu";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";
import { DEFAULT_PUSH_HOUR } from "@/lib/push-schedule";

type NotificationView = {
  configured: boolean;
  feishuWebhookMasked: string;
  /** 每日推送钟点，北京时间 0-23 */
  pushHour: number;
};

type PreferencesRow = {
  feishuWebhookUrl: string | null;
  pushHour: number;
};

/**
 * `feishuWebhookUrl` 三态：缺省=保持不变，空串=清除，非空=校验后保存。
 * 因此这里只能用 `.optional()`，不能给默认值。`pushHour` 同理：缺省=保持不变，
 * 所以只写其中一个字段不会顺手清掉另一个。
 */
const updateSchema = z.object({
  feishuWebhookUrl: z.string().max(500).optional(),
  pushHour: z.number().int().min(0).max(23).optional()
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

function toView(prefs: PreferencesRow): NotificationView {
  const url = prefs.feishuWebhookUrl ?? "";
  return {
    configured: Boolean(url),
    feishuWebhookMasked: maskWebhookUrl(url),
    pushHour: prefs.pushHour
  };
}

/** 没有偏好行的工作区按默认值呈现，不为了读一次就建行。 */
async function loadPreferences(workspaceId: string): Promise<PreferencesRow> {
  const row = await prisma.researchPreferences.findUnique({ where: { workspaceId } });
  return {
    feishuWebhookUrl: row?.feishuWebhookUrl ?? null,
    pushHour: row?.pushHour ?? DEFAULT_PUSH_HOUR
  };
}

async function loadWebhookUrl(workspaceId: string): Promise<string | null> {
  return (await loadPreferences(workspaceId)).feishuWebhookUrl;
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

  return Response.json(toView(await loadPreferences(auth.workspaceId)));
}

export async function PUT(request: Request) {
  const auth = await authorize();
  if (auth instanceof Response) return auth;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "请求格式不正确" }, { status: 400 });
  }

  const { pushHour } = parsed.data;
  const webhookUrl = parsed.data.feishuWebhookUrl?.trim();

  // 两个字段都缺省：什么都不写。
  if (webhookUrl === undefined && pushHour === undefined) {
    return Response.json(toView(await loadPreferences(auth.workspaceId)));
  }

  if (webhookUrl && (!z.string().url().safeParse(webhookUrl).success || !webhookUrl.startsWith("https://"))) {
    return Response.json({ error: "Webhook 必须是 https 地址" }, { status: 400 });
  }

  // 只清 webhook 时用 updateMany，以免为没有偏好行的工作区凭空建行；
  // 一旦要写 pushHour，建行是本来就该发生的（其余字段吃 schema 默认值）。
  if (pushHour === undefined && webhookUrl === "") {
    await prisma.researchPreferences.updateMany({
      where: { workspaceId: auth.workspaceId },
      data: { feishuWebhookUrl: null }
    });
  } else {
    const data = {
      ...(webhookUrl === undefined ? {} : { feishuWebhookUrl: webhookUrl || null }),
      ...(pushHour === undefined ? {} : { pushHour })
    };
    await prisma.researchPreferences.upsert({
      where: { workspaceId: auth.workspaceId },
      update: data,
      create: { workspaceId: auth.workspaceId, ...data }
    });
  }

  return Response.json(toView(await loadPreferences(auth.workspaceId)));
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
  // 测试发送与保存同规则：仅 https，防止 admin 侧的 SSRF 面
  if (!z.string().url().safeParse(webhookUrl).success || !webhookUrl.startsWith("https://")) {
    return Response.json({ error: "Webhook 必须是 https 地址" }, { status: 400 });
  }

  const ok = await sendFeishuCard(webhookUrl, buildTestCard());
  return Response.json({ ok });
}
