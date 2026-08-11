import type { LlmRuntimeConfig } from "./llm-config";
import type { ArxivPaper } from "./arxiv";

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

async function callLlm(
  config: LlmRuntimeConfig,
  messages: { role: string; content: string }[],
  maxTokens = 16000
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      max_tokens: maxTokens,
      response_format: { type: "json_object" }
    })
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
  topics: string[]
): Promise<PaperAnalysisResult> {
  const result = await callLlm(config, [
    { role: "system", content: "你是一个专业的计算机系统研究助手，擅长分析大模型系统方向的学术论文。你的总结要通俗易懂，避免使用论文中的缩写和术语，而是用清晰的日常语言解释技术概念。返回纯 JSON。" },
    {
      role: "user",
      content: `请详细分析这篇论文，用通俗易懂的语言总结，避免使用论文中的缩写：

Title: ${paper.title}
arXiv: ${paper.arxivId}
Authors: ${paper.authors.join(", ")}
Abstract: ${paper.abstract}

用户研究方向：${topics.join(", ")}

请从以下5个角度分析（每个角度都要有实质内容，不能只写一句话）：

返回 JSON：
{
  "title": "${paper.title}",
  "arxivId": "${paper.arxivId}",
  "motivation": "1. Motivation（动机）：这篇文章为什么要做这个工作？现有系统/方法存在什么痛点？用通俗的话解释背景和动机（中文，3-4句）",
  "problem": "2. 核心问题：它具体要解决什么技术问题？把问题讲清楚，不要用缩写（中文，2-3句）",
  "method": "3. 方法：它提出了什么方法来解决？核心思路是什么？有哪些关键的技术设计？用通俗的话解释，不要照搬论文术语（中文，4-5句）",
  "keyFindings": "4. 实验结果：和现有方案比，性能提升了多少？在什么场景下测试的？给出具体的数字和对比（中文，3-4句）",
  "whyItMatters": "5. 改进空间：这篇论文有什么局限性？哪些地方可以进一步改进？对后续研究有什么启发？（中文，2-3句）",
  "summary": "一段话概括这篇论文的核心贡献（中文，2-3句）",
  "keywords": ["english keyword1", "english keyword2", "english keyword3"],
  "relevanceScore": 0.9
}

注意：
- 所有中文分析都要通俗易懂，像给同行讲解一样自然
- 不要使用论文中的缩写（比如不要写 "TTFT"，要写 "首个 token 的生成时间"）
- keywords 用英文、小写、1-4个词
- relevanceScore 根据与用户研究方向的相关性打分 0-1`
    }
  ], 16000);

  return parseJson<PaperAnalysisResult>(result);
}

// Phase 3: Generate daily briefing overview
export async function generateOverview(
  config: LlmRuntimeConfig,
  analyses: PaperAnalysisResult[],
  topics: string[]
): Promise<string> {
  const paperSummaries = analyses
    .map((a, i) => `${i + 1}. ${a.title}\n   - 动机：${a.motivation}\n   - 方法：${a.method}\n   - 结果：${a.keyFindings}`)
    .join("\n\n");

  const result = await callLlm(config, [
    { role: "system", content: "你是一个大模型系统研究趋势分析专家。你的分析要通俗易懂。返回纯 JSON。" },
    {
      role: "user",
      content: `基于今天推荐的 ${analyses.length} 篇论文，写一份简报式的整体概述。

用户研究方向：${topics.join(", ")}

今日论文：
${paperSummaries}

要求：
1. 先用一句话总结今天最值得关注的方向
2. 归纳出 2-3 条今日的技术趋势和观察
3. 指出论文之间的关联（哪些论文在解决类似问题）
4. 给出对研究者的建议（今天最值得精读的 2-3 篇）
5. 语言通俗易懂，不要用缩写

返回 JSON：
{
  "overviewSummary": "完整的今日简报（中文，400-600字）"
}`
    }
  ], 16000);

  const parsed = parseJson<{ overviewSummary: string | Record<string, unknown> }>(result);
  if (typeof parsed.overviewSummary === "string") {
    return parsed.overviewSummary;
  }
  return Object.values(parsed.overviewSummary)
    .map((v) => (Array.isArray(v) ? v.join("\n") : String(v)))
    .join("\n\n");
}
