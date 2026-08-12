import { prisma } from "@paper-viewer/db";
import type { LlmRuntimeConfig } from "./llm-config";

export async function getExistingTopics(workspaceId: string): Promise<string[]> {
  // Gather topics from preferences + all existing paper tags
  const [prefs, allPapers] = await Promise.all([
    prisma.researchPreferences.findUnique({
      where: { workspaceId },
      select: { topics: true, keywords: true }
    }),
    prisma.workspacePaper.findMany({
      where: { workspaceId, state: "visible" },
      select: { tags: true }
    })
  ]);

  const prefTopics = [...(prefs?.topics ?? []), ...(prefs?.keywords ?? [])];
  const paperTags = allPapers.flatMap((p) => p.tags);
  return [...new Set([...prefTopics, ...paperTags])].sort();
}

export async function assignTopics(params: {
  config: LlmRuntimeConfig;
  title: string;
  abstract: string;
  keywords: string[];
  existingTopics: string[];
}): Promise<string[]> {
  const { config, title, abstract, keywords, existingTopics } = params;

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "You are a research paper topic classifier. Always respond with pure JSON."
        },
        {
          role: "user",
          content: `Assign 1-3 topics to this paper.

Paper title: ${title}
Abstract: ${abstract.slice(0, 500)}
Paper keywords: ${keywords.join(", ")}

Existing topics in the system: [${existingTopics.join(", ")}]

Rules:
1. Prefer reusing existing topics when they match semantically
2. If the paper covers a genuinely new area not covered by existing topics, you may add ONE new topic
3. All topics must be in English, lowercase, concise (1-4 words)
4. Do NOT create synonyms of existing topics (e.g., don't create "LLM inference" if "LLM serving" exists)
5. Return 1-3 topics total

Return JSON: {"topics": ["topic1", "topic2"]}`
        }
      ],
      max_tokens: 16000,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) return keywords.slice(0, 3);

  const data = await response.json() as { choices: { message: { content: string } }[] };
  try {
    const parsed = JSON.parse(data.choices[0]!.message.content) as { topics: string[] };
    return parsed.topics;
  } catch {
    return keywords.slice(0, 3);
  }
}
