import { getEnv } from "./env";
import type { ArxivPaper } from "./arxiv";

export type PaperAnalysisResult = {
  title: string;
  arxivId: string;
  summary: string;
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

// Phase 1: Select and rank the most relevant papers
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
    .map((p, i) => `[${i + 1}] ${p.arxivId} | ${p.title}\nAbstract: ${p.abstract.slice(0, 300)}`)
    .join("\n\n");

  const result = await callLlm([
    { role: "system", content: "You are a research paper recommender. Return pure JSON." },
    {
      role: "user",
      content: `Select the ${papersPerDay} most relevant papers for this researcher.

Research interests: ${topics.join(", ") || "not specified"}
Keywords: ${keywords.join(", ") || "not specified"}
Exclude: ${excludedTopics.join(", ") || "none"}

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
    { role: "system", content: "你是一个专业的计算机科学研究助手。返回纯 JSON。" },
    {
      role: "user",
      content: `详细分析这篇论文：

Title: ${paper.title}
arXiv: ${paper.arxivId}
Authors: ${paper.authors.join(", ")}
Abstract: ${paper.abstract}

用户研究方向：${topics.join(", ")}

请返回详细分析（JSON格式）：
{
  "title": "${paper.title}",
  "arxivId": "${paper.arxivId}",
  "summary": "这篇论文的核心贡献和创新点（中文，4-6句，要具体，不要泛泛而谈）",
  "problem": "它要解决什么具体的系统/研究问题，为什么现有方法不够好（中文，2-3句）",
  "method": "核心技术方法和机制（中文，3-4句，包含关键技术细节）",
  "keyFindings": "最重要的实验结果、性能数字、对比（中文，2-3句）",
  "whyItMatters": "为什么值得看，有什么风险或局限性（中文，2-3句）",
  "keywords": ["english keyword1", "english keyword2", "english keyword3"],
  "relevanceScore": 0.9
}

注意：
- 每一项都要有实质内容，不要只写一句话
- keywords 用英文、小写、1-4个词
- relevanceScore 根据与用户研究方向的相关性打分 0-1`
    }
  ], 2000);

  return parseJson<PaperAnalysisResult>(result);
}

// Phase 3: Generate overview summary
export async function generateOverview(analyses: PaperAnalysisResult[], topics: string[]): Promise<string> {
  const paperSummaries = analyses
    .map((a, i) => `${i + 1}. ${a.title}: ${a.summary}`)
    .join("\n");

  const result = await callLlm([
    { role: "system", content: "你是一个研究趋势分析专家。返回纯 JSON。" },
    {
      role: "user",
      content: `基于今天推荐的 ${analyses.length} 篇论文，生成一段整体概述。

用户研究方向：${topics.join(", ")}

论文摘要：
${paperSummaries}

返回 JSON：
{
  "overviewSummary": "今日论文整体概述（中文，300-500字）。包含：1) 今天最值得关注的方向和趋势 2) 论文之间的关联和主题线索 3) 对研究者的具体建议"
}`
    }
  ], 2000);

  const parsed = parseJson<{ overviewSummary: string }>(result);
  return parsed.overviewSummary;
}
