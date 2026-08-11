/**
 * 每日 digest 管道：arXiv 拉取 → 去重 → LLM 选题 → 逐篇分析 → 总览 → 飞书推送。
 *
 * 手动触发（/api/papers/discover）和定时扫描共用这一份实现。整条管道是幂等且可续跑的：
 * 每篇论文分析完就立刻把它从 DailyDigest.pendingPaperIds 里摘掉，那就是断点；
 * 超时（deadline）时返回 partial，下一次运行从剩下的 pending 继续。
 */

import { prisma } from "@paper-viewer/db";
import { fetchArxivPapers, type ArxivPaper } from "@/lib/arxiv";
import { getEnv } from "@/lib/env";
import { buildDigestCard, sendFeishuCard, type DigestPaper } from "@/lib/feishu";
import { analyzeSinglePaper, generateOverview, selectPapers, type PaperAnalysisResult } from "@/lib/llm";
import { resolveLlmConfig, type LlmRuntimeConfig } from "@/lib/llm-config";
import { getPaperText } from "@/lib/paper-text";
import { ensurePdfSnapshot } from "@/lib/pdf-snapshot";

export type DigestRunStatus = "done" | "partial" | "skipped_no_new" | "skipped_done" | "error";

export type DigestRunResult = {
  status: DigestRunStatus;
  /** 本次运行完成分析的论文数 */
  processed: number;
  /** 结束时仍在 pending 里的论文数 */
  remaining: number;
  message?: string;
};

const DEFAULT_CATEGORIES = ["cs.AI", "cs.CL", "cs.LG"];
const MIN_CANDIDATES = 30;
const MAX_TAGS = 3;
const MAX_SUMMARY_LINE = 80;

type DigestRow = {
  id: string;
  overviewSummary: string;
  paperIds: string[];
  pendingPaperIds: string[];
  feishuSentAt: Date | null;
};

type PaperRow = {
  id: string;
  title: string;
  abstract: string | null;
  authors: unknown;
  arxivId: string | null;
  publishedAt: Date | null;
};

type AnalysisRow = {
  paperId: string;
  summary: string;
  motivation: string | null;
  problem: string | null;
  method: string | null;
  keyFindings: string | null;
  whyItMatters: string | null;
  keywords: string[];
};

// ---------------------------------------------------------------- pure helpers

/** digest 只有在「没有待处理论文 + 总览已生成 + 该推的已推」时才算彻底完成。 */
export function isDigestComplete(
  digest: Pick<DigestRow, "overviewSummary" | "pendingPaperIds" | "feishuSentAt">,
  hasWebhook: boolean
): boolean {
  if (digest.pendingPaperIds.length > 0) {
    return false;
  }
  if (!digest.overviewSummary.trim()) {
    return false;
  }
  return !hasWebhook || digest.feishuSentAt !== null;
}

/** 卡片里每篇论文的一行摘要：优先取第一句，句子过长或没有句号就截断。 */
export function summaryLineOf(summary: string | null | undefined): string {
  const text = (summary ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  const sentenceEnd = text.search(/[。！？]/);
  if (sentenceEnd >= 0 && sentenceEnd < MAX_SUMMARY_LINE) {
    return text.slice(0, sentenceEnd + 1);
  }
  return text.length <= MAX_SUMMARY_LINE ? text : `${text.slice(0, MAX_SUMMARY_LINE)}…`;
}

/** 续跑时手上只有 Paper 行，得还原成 analyzeSinglePaper 期待的 arXiv 形状。 */
export function toArxivPaper(paper: PaperRow): ArxivPaper {
  const arxivId = paper.arxivId ?? "";
  return {
    arxivId,
    title: paper.title,
    abstract: paper.abstract ?? "",
    authors: Array.isArray(paper.authors) ? paper.authors.map((a) => String(a)) : [],
    publishedAt: paper.publishedAt?.toISOString() ?? "",
    categories: [],
    url: arxivId ? `https://arxiv.org/abs/${arxivId}` : ""
  };
}

/** 同一篇论文可能有历史分析记录，按时间升序输入时保留最后（最新）一条。 */
export function latestAnalysisPerPaper<T extends { paperId: string }>(rows: T[]): Map<string, T> {
  const byPaper = new Map<string, T>();
  for (const row of rows) {
    byPaper.set(row.paperId, row);
  }
  return byPaper;
}

// ------------------------------------------------------------------- pipeline

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

async function knownArxivIds(workspaceId: string): Promise<Set<string>> {
  const rows = await prisma.workspacePaper.findMany({
    where: { workspaceId, paper: { arxivId: { not: null } } },
    select: { paper: { select: { arxivId: true } } }
  });
  return new Set(rows.map((row) => row.paper.arxivId).filter((id): id is string => Boolean(id)));
}

/** arXiv 元数据直接入库（标题/摘要/作者一律来自 RSS，不用 LLM 抽取的版本）。 */
async function upsertArxivPaper(candidate: ArxivPaper): Promise<PaperRow> {
  const existing = await prisma.paper.findUnique({ where: { arxivId: candidate.arxivId } });
  if (existing) {
    return existing;
  }
  return prisma.paper.create({
    data: {
      title: candidate.title,
      abstract: candidate.abstract || null,
      authors: candidate.authors,
      source: "arxiv",
      sourceId: candidate.arxivId,
      arxivId: candidate.arxivId,
      publishedAt: candidate.publishedAt ? new Date(candidate.publishedAt) : null
    }
  });
}

type Preferences = {
  topics: string[];
  keywords: string[];
  excludedTopics: string[];
  papersPerDay: number;
  arxivCategories: string[];
  feishuWebhookUrl: string | null;
};

/**
 * 建今天的 digest。返回 null 表示「候选全是这个 workspace 已经见过的论文」，
 * 此时不建任何行、也不推送。arXiv / LLM 失败会抛出，由调用方转成 error。
 */
async function createTodayDigest(params: {
  workspaceId: string;
  date: Date;
  prefs: Preferences;
  llm: LlmRuntimeConfig;
}): Promise<DigestRow | null> {
  const { workspaceId, date, prefs, llm } = params;

  const candidates = await fetchArxivPapers({
    categories: prefs.arxivCategories.length ? prefs.arxivCategories : DEFAULT_CATEGORIES,
    keywords: prefs.keywords,
    maxResults: Math.max(prefs.papersPerDay * 4, MIN_CANDIDATES)
  });

  const known = await knownArxivIds(workspaceId);
  const fresh = candidates.filter((candidate) => !known.has(candidate.arxivId));
  if (fresh.length === 0) {
    return null;
  }

  const selectedIds = await selectPapers({
    config: llm,
    papers: fresh,
    topics: prefs.topics,
    keywords: prefs.keywords,
    excludedTopics: prefs.excludedTopics,
    papersPerDay: prefs.papersPerDay
  });
  const selected = selectedIds
    .map((id) => fresh.find((candidate) => candidate.arxivId === id))
    .filter((candidate): candidate is ArxivPaper => Boolean(candidate));
  if (selected.length === 0) {
    throw new Error("LLM 未选出任何候选论文");
  }

  const paperIds: string[] = [];
  for (const candidate of selected) {
    const paper = await upsertArxivPaper(candidate);
    paperIds.push(paper.id);
    await prisma.workspacePaper.upsert({
      where: { workspaceId_paperId: { workspaceId, paperId: paper.id } },
      update: {},
      create: { workspaceId, paperId: paper.id, tags: [] }
    });
  }

  return prisma.dailyDigest.create({
    data: { workspaceId, date, overviewSummary: "", paperIds, pendingPaperIds: paperIds }
  });
}

/** 单篇论文的完整处理：固化 PDF → 预热正文缓存 → LLM 分析 → 落库 + 打标签。 */
async function processPaper(params: {
  workspaceId: string;
  paperId: string;
  llm: LlmRuntimeConfig;
  topics: string[];
}): Promise<void> {
  const { workspaceId, paperId, llm, topics } = params;

  const paper = await prisma.paper.findUnique({ where: { id: paperId } });
  if (!paper) {
    return;
  }

  try {
    await ensurePdfSnapshot(paperId, workspaceId);
  } catch (error) {
    console.error("[daily-digest] pdf snapshot failed", paperId, error);
  }
  // 返回值这里用不上，目的是把正文抽取结果写进缓存，供后续阅读/问答复用
  await getPaperText(paperId);

  const analysis = await analyzeSinglePaper(llm, toArxivPaper(paper), topics);

  await prisma.paperAnalysis.create({
    data: {
      paperId,
      workspaceId,
      summary: analysis.summary,
      motivation: analysis.motivation,
      problem: analysis.problem,
      method: analysis.method,
      keyFindings: analysis.keyFindings,
      whyItMatters: analysis.whyItMatters,
      keywords: analysis.keywords,
      model: llm.model
    }
  });

  await prisma.workspacePaper.updateMany({
    where: { workspaceId, paperId },
    data: { tags: analysis.keywords.slice(0, MAX_TAGS) }
  });
}

async function loadAnalyses(workspaceId: string, paperIds: string[]): Promise<Map<string, AnalysisRow>> {
  const rows = await prisma.paperAnalysis.findMany({
    where: { workspaceId, paperId: { in: paperIds } },
    orderBy: { createdAt: "asc" },
    select: {
      paperId: true,
      summary: true,
      motivation: true,
      problem: true,
      method: true,
      keyFindings: true,
      whyItMatters: true,
      keywords: true
    }
  });
  return latestAnalysisPerPaper(rows);
}

function toAnalysisResult(paper: PaperRow, analysis: AnalysisRow): PaperAnalysisResult {
  return {
    title: paper.title,
    arxivId: paper.arxivId ?? "",
    summary: analysis.summary,
    motivation: analysis.motivation ?? "",
    problem: analysis.problem ?? "",
    method: analysis.method ?? "",
    keyFindings: analysis.keyFindings ?? "",
    whyItMatters: analysis.whyItMatters ?? "",
    keywords: analysis.keywords,
    relevanceScore: 0
  };
}

/** 保持 digest.paperIds 的顺序，缺分析的论文也照样进卡片（只是没有摘要行）。 */
function digestPapers(
  paperIds: string[],
  papers: Map<string, PaperRow>,
  analyses: Map<string, AnalysisRow>
): DigestPaper[] {
  return paperIds.flatMap((paperId) => {
    const paper = papers.get(paperId);
    if (!paper) {
      return [];
    }
    return [{ id: paperId, title: paper.title, summaryLine: summaryLineOf(analyses.get(paperId)?.summary) }];
  });
}

async function notifyFeishu(params: {
  webhookUrl: string;
  date: string;
  digest: DigestRow;
  papers: DigestPaper[];
}): Promise<boolean> {
  const card = buildDigestCard({
    date: params.date,
    overview: params.digest.overviewSummary,
    papers: params.papers,
    appUrl: getEnv().APP_URL
  });
  return sendFeishuCard(params.webhookUrl, card);
}

/**
 * 跑（或续跑）某个 workspace 今天的 digest。
 * `opts.deadline` 是 `Date.now()` 口径的时间戳：每篇论文开始前检查，超过就返回 partial。
 */
export async function runDailyDigest(
  workspaceId: string,
  opts: { deadline: number }
): Promise<DigestRunResult> {
  const prefs = await prisma.researchPreferences.findUnique({ where: { workspaceId } });
  if (!prefs) {
    return { status: "error", processed: 0, remaining: 0, message: "尚未配置研究偏好" };
  }

  const today = utcToday();
  const date = new Date(`${today}T00:00:00Z`);
  const webhookUrl = prefs.feishuWebhookUrl;

  let digest: DigestRow | null = await prisma.dailyDigest.findUnique({
    where: { workspaceId_date: { workspaceId, date } }
  });
  if (digest && isDigestComplete(digest, Boolean(webhookUrl))) {
    return { status: "skipped_done", processed: 0, remaining: 0 };
  }

  let llm: LlmRuntimeConfig;
  try {
    llm = await resolveLlmConfig(workspaceId);
  } catch (error) {
    return { status: "error", processed: 0, remaining: 0, message: messageOf(error) };
  }

  if (!digest) {
    try {
      digest = await createTodayDigest({ workspaceId, date, prefs, llm });
    } catch (error) {
      return { status: "error", processed: 0, remaining: 0, message: messageOf(error) };
    }
    if (!digest) {
      return { status: "skipped_no_new", processed: 0, remaining: 0 };
    }
  }

  let processed = 0;
  while (digest.pendingPaperIds.length > 0) {
    if (Date.now() > opts.deadline) {
      return { status: "partial", processed, remaining: digest.pendingPaperIds.length };
    }
    const paperId: string = digest.pendingPaperIds[0]!;
    try {
      await processPaper({ workspaceId, paperId, llm, topics: prefs.topics });
      processed += 1;
    } catch (error) {
      // 分析失败也要出队，否则这篇论文会把 digest 永远卡住
      console.error("[daily-digest] analysis failed", paperId, error);
    }
    digest = await prisma.dailyDigest.update({
      where: { id: digest.id },
      data: { pendingPaperIds: digest.pendingPaperIds.filter((id) => id !== paperId) }
    });
  }

  const paperRows = await prisma.paper.findMany({ where: { id: { in: digest.paperIds } } });
  const papers = new Map(paperRows.map((paper) => [paper.id, paper]));
  const analyses = await loadAnalyses(workspaceId, digest.paperIds);

  if (!digest.overviewSummary.trim()) {
    let overviewSummary = `今日推荐 ${digest.paperIds.length} 篇论文。`;
    const results = digest.paperIds.flatMap((paperId) => {
      const paper = papers.get(paperId);
      const analysis = analyses.get(paperId);
      return paper && analysis ? [toAnalysisResult(paper, analysis)] : [];
    });
    if (results.length > 0) {
      try {
        overviewSummary = await generateOverview(llm, results, prefs.topics);
      } catch (error) {
        console.error("[daily-digest] overview failed", error);
      }
    }
    digest = await prisma.dailyDigest.update({
      where: { id: digest.id },
      data: { overviewSummary }
    });
  }

  if (webhookUrl && !digest.feishuSentAt) {
    const sent = await notifyFeishu({
      webhookUrl,
      date: today,
      digest,
      papers: digestPapers(digest.paperIds, papers, analyses)
    });
    if (sent) {
      // 只有推成功才落时间戳，失败留空让下一次扫描重试
      digest = await prisma.dailyDigest.update({
        where: { id: digest.id },
        data: { feishuSentAt: new Date() }
      });
    } else {
      console.error("[daily-digest] feishu delivery failed, will retry on next run", digest.id);
    }
  }

  return { status: "done", processed, remaining: 0 };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
