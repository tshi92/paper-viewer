import { getEnv } from "./env";
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

async function callLlm(messages: { role: string; content: string }[], maxTokens = 4000): Promise<string> {
  const env = getEnv();

  const response = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: maxTokens,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`LLM API error ${response.status}: ${text}`);
  }

  const data = await response.json() as {
    choices: { message: { content: string } }[];
  };
  return data.choices[0]!.message.content;
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
  papers: ArxivPaper[];
  topics: string[];
  keywords: string[];
  excludedTopics: string[];
  papersPerDay: number;
}): Promise<string[]> {
  const { papers, topics, keywords, excludedTopics, papersPerDay } = params;

  const paperList = papers
    .slice(0, 30)
    .map((p, i) => `[${i + 1}] ${p.arxivId} | ${p.title}\nAuthors: ${p.authors.slice(0, 3).join(", ")}\nAbstract: ${p.abstract.slice(0, 300)}`)
    .join("\n\n");

  const result = await callLlm([
    { role: "system", content: "You are a research paper recommender for systems researchers. Return pure JSON." },
    {
      role: "user",
      content: `Select the ${papersPerDay} most relevant papers for a researcher working on large language model systems.

Research interests: ${topics.join(", ") || "LLM systems, distributed training, model serving"}
Keywords: ${keywords.join(", ") || "LLM serving, KV cache, MoE, distributed training"}
Exclude: ${excludedTopics.join(", ") || "none"}

Selection criteria:
- Focus on systems papers (infrastructure, serving, training, scheduling, memory management)
- Prefer papers from strong research groups and institutions
- Papers should be relevant to building, optimizing, or deploying large language models
- Include papers from systems venues (EuroSys, OSDI, SOSP, ASPLOS, NSDI) and AI venues (ICML, NeurIPS, ICLR) when applicable
- Avoid pure application papers without systems contributions

Candidate papers:

${paperList}

Return JSON: {"selectedArxivIds": ["arxivId1", "arxivId2", ...]}`
    }
  ], 1000);

  const parsed = parseJson<{ selectedArxivIds: string[] }>(result);
  return parsed.selectedArxivIds;
}

// Phase 2: Deep analysis of a single paper
export async function analyzeSinglePaper(paper: ArxivPaper, topics: string[]): Promise<PaperAnalysisResult> {
  const result = await callLlm([
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
  ], 3000);

  return parseJson<PaperAnalysisResult>(result);
}

// Phase 3: Generate daily briefing overview
export async function generateOverview(analyses: PaperAnalysisResult[], topics: string[]): Promise<string> {
  const paperSummaries = analyses
    .map((a, i) => `${i + 1}. ${a.title}\n   - 动机：${a.motivation}\n   - 方法：${a.method}\n   - 结果：${a.keyFindings}`)
    .join("\n\n");

  const result = await callLlm([
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
  ], 3000);

  const parsed = parseJson<{ overviewSummary: string }>(result);
  return parsed.overviewSummary;
}
