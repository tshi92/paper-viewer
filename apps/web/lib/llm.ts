import type { LlmRuntimeConfig } from "./llm-config";
import type { OutputLanguage } from "@paper-viewer/core/llm-config";
import type { ArxivPaper } from "./arxiv";
import { analysisPrompt, overviewPrompt } from "./prompts";

export type PaperAnalysisResult = {
  title: string;
  arxivId: string;
  summary: string;
  motivation: string;
  problem: string;
  method: string;
  keyFindings: string;
  whyItMatters: string;
  keywords: string[];
  relevanceScore: number;
};

export type DiscoveryResult = {
  overviewSummary: string;
  selectedArxivIds: string[];
  papers: PaperAnalysisResult[];
};

// Statuses worth a retry: transient upstream trouble, most importantly 429 —
// low-tier Kimi accounts allow ONE concurrent request per organization, so an
// interactive chat/analysis racing the digest pipeline is rejected instantly.
const RETRIABLE_STATUS = new Set([429, 500, 502, 503]);
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000];

async function fetchChatCompletions(
  config: LlmRuntimeConfig,
  payload: Record<string, unknown>,
  streaming: boolean
): Promise<Response> {
  // An unbounded call lets one hung upstream request run until the serverless
  // platform hard-kills the whole function (skipping finally blocks and
  // leaving e.g. the digest lock stuck); a thrown AbortError is handled
  // cleanly. For streams only the wait for response headers is bounded here —
  // the caller reads the body under the route's own time limit.
  if (!streaming) {
    return fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(120_000),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(payload)
    });
  }

  const controller = new AbortController();
  const headerTimer = setTimeout(() => controller.abort(), 30_000);
  try {
    return await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`
      },
      body: JSON.stringify(payload)
    });
  } finally {
    clearTimeout(headerTimer);
  }
}

/**
 * POST to the chat-completions endpoint, briefly backing off and retrying on
 * 429/5xx before giving up. Network errors and timeouts are NOT retried — they
 * already consumed real time and propagate to the caller.
 */
export async function requestChatCompletions(
  config: LlmRuntimeConfig,
  payload: Record<string, unknown>,
  opts: { streaming?: boolean; retryDelaysMs?: number[] } = {}
): Promise<Response> {
  const delays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    const response = await fetchChatCompletions(config, payload, opts.streaming ?? false);
    const delay = delays[attempt];
    if (response.ok || delay === undefined || !RETRIABLE_STATUS.has(response.status)) {
      return response;
    }
    // Drain the failed body so the connection can be reused, then wait.
    await response.text().catch(() => "");
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function callLlm(
  config: LlmRuntimeConfig,
  messages: { role: string; content: string }[],
  maxTokens = 16000
): Promise<string> {
  const response = await requestChatCompletions(config, {
    model: config.model,
    messages,
    max_tokens: maxTokens,
    response_format: { type: "json_object" }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error ${response.status}: ${text}`);
  }

  const data = await response.json() as {
    choices: { message: { content: string; reasoning_content?: string } }[];
  };
  const content = data.choices[0]!.message.content;
  if (!content) {
    throw new Error("LLM returned empty content (reasoning model may need higher max_tokens)");
  }
  return content;
}

function parseJson<T>(text: string): T {
  let jsonStr = text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(jsonStr) as T;
}

// Phase 1: Select the most relevant papers
export async function selectPapers(params: {
  config: LlmRuntimeConfig;
  papers: ArxivPaper[];
  topics: string[];
  keywords: string[];
  excludedTopics: string[];
  papersPerDay: number;
}): Promise<string[]> {
  const { config, papers, topics, keywords, excludedTopics, papersPerDay } = params;

  // Pre-filter: score papers by keyword relevance, take top candidates
  const allTerms = [...topics, ...keywords].map((t) => t.toLowerCase());
  const scored = papers.map((p) => {
    const text = `${p.title} ${p.abstract}`.toLowerCase();
    const hits = allTerms.filter((t) => text.includes(t)).length;
    return { paper: p, hits };
  });
  scored.sort((a, b) => b.hits - a.hits);
  const topPapers = scored.slice(0, 50).map((s) => s.paper);

  const paperList = topPapers
    .map((p, i) => `[${i + 1}] ${p.arxivId} | ${p.title}\nAuthors: ${p.authors.slice(0, 3).join(", ")}\nAbstract: ${p.abstract.slice(0, 300)}`)
    .join("\n\n");

  const topicStr = topics.join(", ") || "AI/ML research";
  const keywordStr = keywords.join(", ") || "machine learning";

  const result = await callLlm(config, [
    { role: "system", content: "You are a research paper recommender. Return pure JSON." },
    {
      role: "user",
      content: `Select the ${papersPerDay} most relevant papers for a researcher.

Research interests: ${topicStr}
Keywords: ${keywordStr}
Exclude: ${excludedTopics.join(", ") || "none"}

Selection criteria:
- Prioritize papers closely related to the researcher's interests and keywords
- Prefer papers with novel methods, strong experiments, or from recognized research groups
- Include a mix of core-topic papers and interesting adjacent work
- You MUST select exactly ${papersPerDay} papers (no more, no less)

Candidate papers:

${paperList}

Return JSON: {"selectedArxivIds": ["arxivId1", "arxivId2", ...]}`
    }
  ], 16000);

  const parsed = parseJson<{ selectedArxivIds: string[] }>(result);
  return parsed.selectedArxivIds;
}

// Phase 2: Deep analysis of a single paper
export async function analyzeSinglePaper(
  config: LlmRuntimeConfig,
  paper: ArxivPaper,
  topics: string[],
  language: OutputLanguage
): Promise<PaperAnalysisResult> {
  // The LLM occasionally returns invalid JSON (for example an unescaped quote
  // inside a Chinese string); a single retry all but eliminates it.
  // Only retry on the SyntaxError thrown by JSON.parse: retrying a 401 / 429 /
  // network error is pointless and would just burn another full call.
  try {
    return await analyzeSinglePaperOnce(config, paper, topics, language);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    return analyzeSinglePaperOnce(config, paper, topics, language);
  }
}

async function analyzeSinglePaperOnce(
  config: LlmRuntimeConfig,
  paper: ArxivPaper,
  topics: string[],
  language: OutputLanguage
): Promise<PaperAnalysisResult> {
  const prompt = analysisPrompt(language, paper, topics);
  const result = await callLlm(config, [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user }
  ], 16000);

  return parseJson<PaperAnalysisResult>(result);
}

// Phase 3: Generate daily briefing overview
export async function generateOverview(
  config: LlmRuntimeConfig,
  analyses: PaperAnalysisResult[],
  topics: string[],
  language: OutputLanguage
): Promise<string> {
  const prompt = overviewPrompt(language, analyses, topics);
  const result = await callLlm(config, [
    { role: "system", content: prompt.system },
    { role: "user", content: prompt.user }
  ], 16000);

  const parsed = parseJson<{ overviewSummary: string | Record<string, unknown> }>(result);
  if (typeof parsed.overviewSummary === "string") {
    return parsed.overviewSummary;
  }
  return Object.values(parsed.overviewSummary)
    .map((v) => (Array.isArray(v) ? v.join("\n") : String(v)))
    .join("\n\n");
}
