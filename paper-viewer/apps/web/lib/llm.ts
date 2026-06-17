import { getEnv } from "./env";
import type { ArxivPaper } from "./arxiv";

type PaperAnalysisResult = {
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

type DiscoveryResult = {
  overviewSummary: string;
  papers: PaperAnalysisResult[];
};

async function callLlm(messages: { role: string; content: string }[]): Promise<string> {
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
      max_tokens: 16000,
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

export async function analyzeAndRankPapers(params: {
  papers: ArxivPaper[];
  topics: string[];
  keywords: string[];
  excludedTopics: string[];
  papersPerDay: number;
}): Promise<DiscoveryResult> {
  const { papers, topics, keywords, excludedTopics, papersPerDay } = params;

  // Truncate abstracts to keep prompt manageable
  const paperList = papers
    .slice(0, 25)
    .map((p, i) => `[${i + 1}] ${p.title}\narXiv: ${p.arxivId}\nAuthors: ${p.authors.slice(0, 5).join(", ")}\nAbstract: ${p.abstract.slice(0, 500)}`)
    .join("\n\n---\n\n");

  const prompt = `你是一个研究论文推荐系统。用户的研究兴趣如下：

研究方向：${topics.join("、") || "未指定"}
关键词：${keywords.join("、") || "未指定"}
排除方向：${excludedTopics.join("、") || "无"}

以下是今天 arXiv 上的 ${Math.min(papers.length, 25)} 篇候选论文：

${paperList}

请你完成以下任务：

1. 从中筛选出最相关的 ${papersPerDay} 篇论文
2. 对每篇论文生成结构化分析
3. 生成一段整体概述

请严格返回以下 JSON 格式：

{
  "overviewSummary": "今日论文整体概述（中文，200-400字，总结趋势和要点）",
  "papers": [
    {
      "title": "论文标题",
      "arxivId": "arXiv ID（只要数字部分如 2606.15177）",
      "summary": "核心贡献（中文，2-3句）",
      "problem": "要解决的问题（中文，1-2句）",
      "method": "核心方法（中文，1-2句）",
      "keyFindings": "关键发现（中文，1-2句）",
      "whyItMatters": "为什么值得看（中文，1-2句）",
      "keywords": ["从用户关键词列表中选取最相关的2-3个，优先复用已有关键词"],
      "relevanceScore": 0.95
    }
  ]
}

重要：
- papers 数组按 relevanceScore 从高到低排序
- keywords 尽量从用户的研究方向和关键词中复用，避免创造含义相同的新词
- 每篇论文最多3个keywords`;

  const result = await callLlm([
    { role: "system", content: "你是一个专业的计算机科学研究助手，擅长分析和推荐学术论文。你只返回 JSON 格式的数据。" },
    { role: "user", content: prompt }
  ]);

  // Parse JSON from response, handling possible markdown wrapping
  let jsonStr = result.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  return JSON.parse(jsonStr) as DiscoveryResult;
}
