import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { canManageLabels } from "@paper-viewer/core/permissions";
import { maskApiKey } from "@paper-viewer/core/llm-config";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";

type ConfigSource = "db" | "env" | "none";

type EffectiveConfig = {
  source: ConfigSource;
  baseUrl: string;
  model: string;
  apiKey: string;
};

type ConfigView = {
  source: ConfigSource;
  baseUrl: string;
  model: string;
  apiKeyMasked: string;
};

const TEST_TIMEOUT_MS = 15_000;
const MAX_LISTED_MODELS = 10;

const updateSchema = z.object({
  baseUrl: z.string().url(),
  model: z.string().min(1).max(100),
  apiKey: z.string().max(200).optional()
});

const testSchema = z.object({
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).max(100).optional(),
  apiKey: z.string().max(200).optional()
});

async function resolveCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await requireCurrentUser();
  } catch {
    return null;
  }
}

/** DB 行优先，其次 env，都没有则 none(仍返回 env 默认的 baseUrl/model 方便前端预填)。 */
async function loadEffectiveConfig(workspaceId: string): Promise<EffectiveConfig> {
  const row = await prisma.llmConfig.findUnique({ where: { workspaceId } });
  if (row) {
    return { source: "db", baseUrl: row.baseUrl, model: row.model, apiKey: row.apiKey };
  }

  const env = getEnv();
  if (env.LLM_API_KEY) {
    return { source: "env", baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL, apiKey: env.LLM_API_KEY };
  }

  return { source: "none", baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL, apiKey: "" };
}

function toConfigView(config: EffectiveConfig): ConfigView {
  return {
    source: config.source,
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyMasked: maskApiKey(config.apiKey)
  };
}

function trimmedOrEmpty(value: string | undefined): string {
  return value?.trim() ?? "";
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function extractModelIds(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => (typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string");
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (typeof payload !== "object" || payload === null) return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string" && error) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  const message = (payload as { message?: unknown }).message;
  if (typeof message === "string" && message) return message;
  return fallback;
}

export async function GET() {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!canManageLabels(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const config = await loadEffectiveConfig(user.workspaceId);
  return Response.json(toConfigView(config));
}

export async function PUT(request: Request) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!canManageLabels(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const input = updateSchema.parse(await request.json());
  const baseUrl = input.baseUrl.trim();
  const model = input.model.trim();
  const apiKey = trimmedOrEmpty(input.apiKey);

  if (apiKey) {
    const row = await prisma.llmConfig.upsert({
      where: { workspaceId: user.workspaceId },
      update: { baseUrl, model, apiKey },
      create: { workspaceId: user.workspaceId, baseUrl, model, apiKey }
    });
    return Response.json(toConfigView({ source: "db", baseUrl: row.baseUrl, model: row.model, apiKey: row.apiKey }));
  }

  const existing = await prisma.llmConfig.findUnique({ where: { workspaceId: user.workspaceId } });
  if (!existing) {
    return Response.json({ error: "首次保存必须提供 API Key" }, { status: 400 });
  }

  const row = await prisma.llmConfig.update({
    where: { workspaceId: user.workspaceId },
    data: { baseUrl, model }
  });
  return Response.json(toConfigView({ source: "db", baseUrl: row.baseUrl, model: row.model, apiKey: row.apiKey }));
}

export async function POST(request: Request) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!canManageLabels(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const input = testSchema.parse(await request.json());
  const current = await loadEffectiveConfig(user.workspaceId);
  const baseUrl = trimmedOrEmpty(input.baseUrl) || current.baseUrl;
  const model = trimmedOrEmpty(input.model) || current.model;
  const apiKey = trimmedOrEmpty(input.apiKey) || current.apiKey;

  let response: Response;
  try {
    response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS)
    });
  } catch {
    return Response.json({ ok: false, status: 0, message: "连接失败或超时" });
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    return Response.json({
      ok: false,
      status: response.status,
      message: extractErrorMessage(payload, `HTTP ${response.status}`)
    });
  }

  const modelIds = extractModelIds(payload);
  return Response.json({
    ok: true,
    total: modelIds.length,
    models: modelIds.slice(0, MAX_LISTED_MODELS),
    modelFound: modelIds.includes(model)
  });
}
