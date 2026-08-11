import { prisma } from "@paper-viewer/db";
import { getEnv } from "@/lib/env";

export type LlmRuntimeConfig = { baseUrl: string; model: string; apiKey: string };

/** DB 配置优先，env 兜底；两者都没有 key 时抛出明确错误。 */
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
