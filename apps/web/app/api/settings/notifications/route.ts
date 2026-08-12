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
  /** Hour of the daily push, in Beijing time, 0-23 */
  pushHour: number;
};

type PreferencesRow = {
  feishuWebhookUrl: string | null;
  pushHour: number;
};

/**
 * `feishuWebhookUrl` has three states: absent = leave unchanged, empty string =
 * clear, non-empty = validate and save. That is why only `.optional()` works here
 * and no default may be given. The same goes for `pushHour`: absent = leave
 * unchanged, so writing just one of the two fields does not incidentally clear
 * the other.
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

/** A workspace with no preferences row is presented with the defaults; a row is not created just to serve a read. */
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

/** Single entry point for 401/403: returns either the CurrentUser or a Response that should go straight back to the client. */
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

  // Both fields absent: write nothing.
  if (webhookUrl === undefined && pushHour === undefined) {
    return Response.json(toView(await loadPreferences(auth.workspaceId)));
  }

  if (webhookUrl && (!z.string().url().safeParse(webhookUrl).success || !webhookUrl.startsWith("https://"))) {
    return Response.json({ error: "Webhook 必须是 https 地址" }, { status: 400 });
  }

  // When only clearing the webhook, use updateMany so that no row is conjured up
  // for a workspace that has no preferences row; once pushHour is being written,
  // creating the row is what should happen anyway (the remaining fields take the
  // schema defaults).
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

/** Only sends a test card, never persists anything; the address in the request body is used as-is, which makes it easy to try before saving. */
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
  // Test sends follow the same rule as saving: https only, to close off an SSRF
  // surface on the admin side
  if (!z.string().url().safeParse(webhookUrl).success || !webhookUrl.startsWith("https://")) {
    return Response.json({ error: "Webhook 必须是 https 地址" }, { status: 400 });
  }

  const ok = await sendFeishuCard(webhookUrl, buildTestCard());
  return Response.json({ ok });
}
