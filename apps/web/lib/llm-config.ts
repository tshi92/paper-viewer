import { prisma } from "@paper-viewer/db";
import { getEnv } from "@/lib/env";

export type LlmRuntimeConfig = { baseUrl: string; model: string; apiKey: string };

/** The DB configuration wins, with env as the fallback; if neither has a key, throw an explicit error. */
export async function resolveLlmConfig(workspaceId: string): Promise<LlmRuntimeConfig> {
  const row = await prisma.llmConfig.findUnique({ where: { workspaceId } });
  if (row) {
    return { baseUrl: row.baseUrl, model: row.model, apiKey: row.apiKey };
  }

  const env = getEnv();
  if (!env.LLM_API_KEY) {
    throw new Error("LLM not configured: set it in Settings → LLM or via env");
  }
  return { baseUrl: env.LLM_BASE_URL, model: env.LLM_MODEL, apiKey: env.LLM_API_KEY };
}
