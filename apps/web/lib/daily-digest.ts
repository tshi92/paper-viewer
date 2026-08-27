/**
 * Daily digest pipeline: fetch from arXiv → dedupe → LLM selection → per-paper
 * analysis → overview → Feishu push.
 *
 * The manual trigger (/api/papers/discover) and the scheduled scan share this one
 * implementation. The whole pipeline is idempotent and resumable: each paper is
 * removed from DailyDigest.pendingPaperIds as soon as its analysis finishes, and
 * that is the resume point; on timeout (deadline) it returns partial and the next
 * run continues from the remaining pending entries.
 *
 * Concurrency safety: the two daily cron runs (plus a manual discover) may
 * overlap, so before advancing a digest we claim the DailyDigest.lockedAt lock and
 * return locked if we cannot get it. The three remaining races — creating the
 * digest row, creating papers, and pushing to Feishu — are each resolved by a
 * P2002 fallback or a conditional updateMany write.
 */

import { prisma } from "@paper-viewer/db";
import { fetchArxivPapers, type ArxivPaper } from "@/lib/arxiv";
import { getEnv } from "@/lib/env";
import { buildDigestCard, sendFeishuCard, type DigestPaper } from "@/lib/feishu";
import {
  analyzeSinglePaper,
  generateOverview,
  LlmRateLimitError,
  selectPapers,
  type PaperAnalysisResult
} from "@/lib/llm";
import { runAdaptivePool } from "@/lib/adaptive-pool";
import { isCompleteOverview } from "@/lib/prompts";
import { getPaperText } from "@/lib/paper-text";
import type { SourceMaterial } from "@/lib/prompts";
import { toOutputLanguage, type OutputLanguage } from "@paper-viewer/core/llm-config";
import { resolveLlmConfig, type LlmRuntimeConfig } from "@/lib/llm-config";
import { ensurePdfSnapshot } from "@/lib/pdf-snapshot";

export type DigestRunStatus =
  | "done"
  | "partial"
  | "skipped_no_new"
  | "skipped_done"
  | "locked"
  | "error";

export type DigestRunResult = {
  status: DigestRunStatus;
  /** Number of papers whose analysis finished during this run */
  processed: number;
  /** Number of papers still pending when the run ended */
  remaining: number;
  message?: string;
};

const DEFAULT_CATEGORIES = ["cs.AI", "cs.CL", "cs.LG"];
const MIN_CANDIDATES = 30;
const MAX_TAGS = 3;
const MAX_SUMMARY_LINE = 80;
/** Lock expiry: if the lock holder is hard-killed (Vercel timeout), the next cron run can take over once this window has passed. */
const LOCK_TTL_MS = 10 * 60_000;
/**
 * Budget reserved per paper: pinning the PDF (up to 60s before its fetch
 * timeout) plus one full LLM analysis (up to 120s before its timeout) can take
 * this long in the worst case. We stop once the remaining budget cannot cover
 * a whole paper, so we do not start one only to have Vercel cut it off midway
 * — a hard kill skips `finally` and leaves the digest lock stuck for
 * LOCK_TTL_MS. Production showed real papers exceeding the previous 60s
 * estimate, which is exactly how a run got hard-killed.
 */
const PER_PAPER_MARGIN_MS = 150_000;

/**
 * Where the analysis pool starts. Not a promise about any provider — the pool
 * halves itself on every rate-limited answer, so against a single-slot
 * provider this costs one wasted volley before settling at 1. Ten papers a
 * day is the whole queue, so anything higher buys nothing.
 */
const ANALYSIS_CONCURRENCY = 8;

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

/** A digest counts as fully complete only when there are no pending papers, the overview has been generated, and anything that should have been pushed has been pushed. */
/**
 * Stands in for the briefing when not one paper could be analysed — an LLM
 * outage, or an account that is rate-limited for the whole run. Recognisable on
 * sight so a later run can tell it apart from a real overview and replace it.
 */
export function placeholderOverview(count: number): string {
  return `今日推荐 ${count} 篇论文。`;
}

export function isDigestComplete(
  digest: Pick<DigestRow, "overviewSummary" | "pendingPaperIds" | "paperIds" | "feishuSentAt">,
  hasWebhook: boolean,
  language: OutputLanguage
): boolean {
  if (digest.pendingPaperIds.length > 0) {
    return false;
  }
  // The same judgement a fresh generation must pass. "Non-empty" used to be
  // the bar here, and both the placeholder and a mid-sentence fragment
  // (2026-08-27) cleared it — so every later run answered skipped_done and the
  // broken text could never heal in place. With nothing pending, every paper
  // has an analysis (advance re-queues the ones missing one), so paperIds is
  // the count the briefing is expected to cover.
  if (!isCompleteOverview(digest.overviewSummary, digest.paperIds.length, language)) {
    return false;
  }
  return !hasWebhook || digest.feishuSentAt !== null;
}

/**
 * Which digest the Today page shows in full, given the week's digests newest
 * first.
 *
 * Today's when it exists, and otherwise the most recent one — never nothing
 * while any digest exists. The two clocks do not line up: the date key rolls
 * over at 00:00 UTC (08:00 Beijing) but the run happens at the workspace's push
 * hour, 13:00 by default, so for those hours there is no digest for today and a
 * strict match would blank the page's main content every single morning. The
 * card carries the digest's own date, so falling back never passes an older
 * edition off as today's.
 */
export function pickLeadDigest<T extends { date: Date }>(
  digestsNewestFirst: readonly T[],
  todayUtc: string
): T | undefined {
  const today = digestsNewestFirst.find(
    (digest) => digest.date.toISOString().slice(0, 10) === todayUtc
  );
  return today ?? digestsNewestFirst[0];
}

/** One-line summary for each paper in the card: prefer the first sentence, and truncate when that sentence is too long or there is no sentence-ending punctuation. */
export function summaryLineOf(summary: string | null | undefined): string {
  const text = (summary ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return "";
  }
  // Latin enders only count when a space or the end follows, so "2.1x" and
  // "Fig. 1" do not read as the end of a sentence.
  const sentenceEnd = text.search(/[。！？]|[.!?](?=\s|$)/);
  if (sentenceEnd >= 0 && sentenceEnd < MAX_SUMMARY_LINE) {
    return text.slice(0, sentenceEnd + 1);
  }
  return text.length <= MAX_SUMMARY_LINE ? text : `${text.slice(0, MAX_SUMMARY_LINE)}…`;
}

/** On a resumed run we only have the Paper row, so it has to be reshaped back into the arXiv shape analyzeSinglePaper expects. */
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

/**
 * Prisma's unique constraint violation (P2002). Concurrent runs racing to create
 * the same row hit this; it means "someone else already created it", so we just
 * read the row back and carry on — it is not a real error.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

/** A paper may have older analysis records, so with rows fed in ascending time order we keep the last (most recent) one. */
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

/**
 * Everything this workspace has already been shown: papers saved to the
 * library AND papers surfaced by any earlier digest. Digest papers no longer
 * enter the library automatically, so deduplicating against the library alone
 * would re-recommend an unsaved paper every single day.
 */
async function seenArxivIds(workspaceId: string): Promise<Set<string>> {
  const [libraryRows, digests] = await Promise.all([
    prisma.workspacePaper.findMany({
      where: { workspaceId, paper: { arxivId: { not: null } } },
      select: { paper: { select: { arxivId: true } } }
    }),
    prisma.dailyDigest.findMany({ where: { workspaceId }, select: { paperIds: true } })
  ]);

  const seen = new Set(
    libraryRows.map((row) => row.paper.arxivId).filter((id): id is string => Boolean(id))
  );
  const digestPaperIds = [...new Set(digests.flatMap((digest) => digest.paperIds))];
  if (digestPaperIds.length > 0) {
    const digestPapers = await prisma.paper.findMany({
      where: { id: { in: digestPaperIds }, arxivId: { not: null } },
      select: { arxivId: true }
    });
    for (const paper of digestPapers) {
      if (paper.arxivId) seen.add(paper.arxivId);
    }
  }
  return seen;
}

/**
 * Store arXiv metadata directly (title/abstract/authors always come from the RSS
 * feed, never from an LLM-extracted version).
 * Between the find and the create another run may have inserted the same paper,
 * so on a P2002 we read its row back.
 */
async function upsertArxivPaper(candidate: ArxivPaper): Promise<PaperRow> {
  const existing = await prisma.paper.findUnique({ where: { arxivId: candidate.arxivId } });
  if (existing) {
    return existing;
  }
  try {
    return await prisma.paper.create({
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
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    const raced = await prisma.paper.findUnique({ where: { arxivId: candidate.arxivId } });
    if (!raced) {
      throw error;
    }
    return raced;
  }
}

type Preferences = {
  topics: string[];
  keywords: string[];
  excludedTopics: string[];
  papersPerDay: number;
  arxivCategories: string[];
  feishuWebhookUrl: string | null;
  /** Raw column value; `toOutputLanguage` narrows it at the point of use. */
  outputLanguage: string;
};

/**
 * Create today's digest. Returning null means every candidate is a paper this
 * workspace has already seen; in that case no row is created and nothing is
 * pushed. arXiv / LLM failures throw, and the caller turns them into an error.
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

  const known = await seenArxivIds(workspaceId);
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

  // Digest papers stay out of the library on purpose: only an explicit
  // "save to library" creates the WorkspacePaper row.
  const paperIds: string[] = [];
  for (const candidate of selected) {
    const paper = await upsertArxivPaper(candidate);
    paperIds.push(paper.id);
  }

  try {
    return await prisma.dailyDigest.create({
      data: { workspaceId, date, overviewSummary: "", paperIds, pendingPaperIds: paperIds }
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A concurrent run already created today's row, so take it over (the papers
    // selected by this run still remain in the library)
    const raced = await prisma.dailyDigest.findUnique({
      where: { workspaceId_date: { workspaceId, date } }
    });
    if (!raced) {
      throw error;
    }
    return raced;
  }
}

/**
 * Claim the right to advance this day's digest. Returning false means another run
 * is in progress and the caller should bow out immediately.
 * A `lockedAt` older than LOCK_TTL_MS is treated as a previous holder having been
 * hard-killed, and taking over is allowed.
 */
async function claimDigestLock(digestId: string): Promise<boolean> {
  const { count } = await prisma.dailyDigest.updateMany({
    where: {
      id: digestId,
      OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - LOCK_TTL_MS) } }]
    },
    data: { lockedAt: new Date() }
  });
  return count === 1;
}

async function releaseDigestLock(digestId: string): Promise<void> {
  await prisma.dailyDigest.updateMany({ where: { id: digestId }, data: { lockedAt: null } });
}

/**
 * Claim before sending: flip feishuSentAt from null to now, and only the run whose
 * write succeeded (count===1) sends the card. That way two concurrent runs do not
 * each send one. If sending fails we clear the timestamp again and leave it for
 * the next scan to retry.
 */
async function claimFeishuSend(digestId: string): Promise<boolean> {
  const { count } = await prisma.dailyDigest.updateMany({
    where: { id: digestId, feishuSentAt: null },
    data: { feishuSentAt: new Date() }
  });
  return count === 1;
}

async function revertFeishuSend(digestId: string): Promise<void> {
  await prisma.dailyDigest.updateMany({ where: { id: digestId }, data: { feishuSentAt: null } });
}

/**
 * Manually backfill the analysis for a single paper (the generate button on the
 * Analysis tab). It reuses the pipeline's per-paper processing, so the output is
 * exactly the same as the daily digest's.
 *
 * `replace` regenerates over an existing analysis (the ⋮ menu on the Intro
 * card); the old one stays in place until the new one has been written, so a
 * failed regeneration never costs the intro that was already there.
 */
export async function analyzePaperOnDemand(
  workspaceId: string,
  paperId: string,
  options?: { replace?: boolean }
): Promise<boolean> {
  const llm = await resolveLlmConfig(workspaceId);
  const prefs = await prisma.researchPreferences.findUnique({ where: { workspaceId } });
  return processPaper({
    workspaceId,
    paperId,
    llm,
    topics: prefs?.topics ?? [],
    language: toOutputLanguage(prefs?.outputLanguage),
    replaceExisting: options?.replace ?? false
  });
}

/**
 * Full processing of one paper: pin the PDF → LLM analysis → persist + tag.
 * Returns false when the paper carries nothing to analyse, which is not a
 * failure — see the source-material comment below.
 */
async function processPaper(params: {
  workspaceId: string;
  paperId: string;
  llm: LlmRuntimeConfig;
  topics: string[];
  language: OutputLanguage;
  /** Regenerate over an existing analysis instead of yielding to it. */
  replaceExisting?: boolean;
}): Promise<boolean> {
  const { workspaceId, paperId, llm, topics, language, replaceExisting = false } = params;

  const paper = await prisma.paper.findUnique({ where: { id: paperId } });
  if (!paper) {
    return false;
  }

  // Pinning the PDF is what keeps annotation anchors from drifting, so it is
  // mandatory; full-text extraction, on the other hand, is not pre-warmed —
  // analyzeSinglePaper only uses the title + abstract, and chat extracts the text
  // itself on first use. Running it here would add one extra download + parse per
  // paper and burn the run budget for nothing.
  try {
    await ensurePdfSnapshot(paperId, workspaceId);
  } catch (error) {
    console.error("[daily-digest] pdf snapshot failed", paperId, error);
  }

  // What the analysis is written from. The prompt asks for a motivation, a
  // method and measured results; from a bare title the model has no choice but
  // to invent all three, confidently. arXiv papers carry an abstract, but a
  // conference catalog entry never does — the upstream feed is titles and
  // authors — so those are grounded in the PDF's text instead. A paper with
  // neither is left without an intro rather than given a fabricated one.
  const abstract = paper.abstract?.trim() ?? "";
  let source: SourceMaterial;
  if (abstract) {
    source = { kind: "abstract", text: abstract };
  } else {
    const fullText = (await getPaperText(paperId))?.trim();
    if (!fullText) {
      console.warn("[analysis] skipped: no abstract and no readable PDF", paperId);
      return false;
    }
    source = { kind: "fullText", text: fullText };
  }

  const analysis = await analyzeSinglePaper(llm, toArxivPaper(paper), topics, language, source);

  // A concurrent generation may have landed while the model ran (two members
  // opening the same intro-less paper triggers two on-demand runs; the route's
  // pre-check cannot cover a minutes-long window). First writer wins — unless
  // this run is an explicit regeneration, whose whole point is to overwrite.
  if (!replaceExisting) {
    const alreadyAnalyzed = await prisma.paperAnalysis.findFirst({
      where: { workspaceId, paperId },
      select: { id: true }
    });
    if (alreadyAnalyzed) {
      return false;
    }
  }

  const analysisData = {
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
  };
  if (replaceExisting) {
    // Swap atomically: readers always see either the old analysis or the new
    // one, never a gap. Only reached after generation succeeded, so a failed
    // regeneration leaves the old analysis untouched.
    await prisma.$transaction([
      prisma.paperAnalysis.deleteMany({ where: { workspaceId, paperId } }),
      prisma.paperAnalysis.create({ data: analysisData })
    ]);
  } else {
    await prisma.paperAnalysis.create({ data: analysisData });
  }

  // The analysis keywords double as library tags, but the WorkspacePaper row
  // only exists once someone saves the paper — updateMany is a no-op until
  // then and fills the tags in for papers that were saved before analysis
  // finished (manual discover while someone reads along).
  await prisma.workspacePaper.updateMany({
    where: { workspaceId, paperId, tags: { isEmpty: true } },
    data: { tags: analysis.keywords.slice(0, MAX_TAGS) }
  });
  return true;
}

/** The library tags a saved digest paper starts with: its latest analysis keywords. */
export async function analysisTags(workspaceId: string, paperId: string): Promise<string[]> {
  const latest = await prisma.paperAnalysis.findFirst({
    where: { workspaceId, paperId },
    orderBy: { createdAt: "desc" },
    select: { keywords: true }
  });
  return latest?.keywords.slice(0, MAX_TAGS) ?? [];
}

/**
 * Digest papers with no analysis, in the digest's own order — the papers a run
 * dropped on the floor and a later run should pick back up.
 */
export function papersToRequeue(
  paperIds: string[],
  analysedPaperIds: ReadonlySet<string>
): string[] {
  return paperIds.filter((paperId) => !analysedPaperIds.has(paperId));
}

/** papersToRequeue against what this workspace has actually analysed. */
async function papersMissingAnalysis(workspaceId: string, paperIds: string[]): Promise<string[]> {
  if (paperIds.length === 0) return [];
  const rows = await prisma.paperAnalysis.findMany({
    where: { workspaceId, paperId: { in: paperIds } },
    select: { paperId: true }
  });
  return papersToRequeue(paperIds, new Set(rows.map((row) => row.paperId)));
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

/** Preserve the order of digest.paperIds; papers without an analysis still make it into the card (just without a summary line). */
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
  language: OutputLanguage;
}): Promise<boolean> {
  const card = buildDigestCard({
    date: params.date,
    overview: params.digest.overviewSummary,
    papers: params.papers,
    appUrl: getEnv().APP_URL,
    language: params.language
  });
  return sendFeishuCard(params.webhookUrl, card);
}

/**
 * Run (or resume) today's digest for a workspace.
 * `opts.deadline` is a timestamp on the `Date.now()` scale: it is checked before
 * each paper, and if the remaining budget cannot cover a whole paper
 * (PER_PAPER_MARGIN_MS) the run returns partial.
 *
 * Returns locked when the concurrency lock cannot be acquired — another run is
 * already advancing the same day's digest, so this one does nothing.
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

  // A paper whose analysis threw is dequeued so one bad paper cannot block the
  // digest forever — but that also meant a day where every call failed (an LLM
  // outage, a rate-limited account) was marked complete with no analyses and no
  // way back: the placeholder overview is non-empty, so isDigestComplete said
  // done and every later run skipped it. Re-queue what is still missing, so the
  // next run retries it. A paper that keeps failing costs one call per run
  // rather than being lost.
  if (digest && digest.pendingPaperIds.length === 0) {
    const missing = await papersMissingAnalysis(workspaceId, digest.paperIds);
    if (missing.length > 0) {
      digest = await prisma.dailyDigest.update({
        where: { id: digest.id },
        data: { pendingPaperIds: missing }
      });
    }
  }

  if (digest && isDigestComplete(digest, Boolean(webhookUrl), toOutputLanguage(prefs.outputLanguage))) {
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

  if (!(await claimDigestLock(digest.id))) {
    return { status: "locked", processed: 0, remaining: digest.pendingPaperIds.length };
  }

  try {
    return await advanceDigest({ workspaceId, digest, prefs, llm, today, webhookUrl, opts });
  } finally {
    // Release the lock on partial / error too: a genuine hard kill is covered by
    // LOCK_TTL_MS, and there is no reason to hold it across a normal return
    await releaseDigestLock(digest.id);
  }
}

/** The actual work done under the lock: analyze each paper → overview → Feishu. The caller guarantees the lock is held. */
async function advanceDigest(params: {
  workspaceId: string;
  digest: DigestRow;
  prefs: Preferences;
  llm: LlmRuntimeConfig;
  today: string;
  webhookUrl: string | null;
  opts: { deadline: number };
}): Promise<DigestRunResult> {
  const { workspaceId, prefs, llm, today, webhookUrl, opts } = params;
  const language = toOutputLanguage(prefs.outputLanguage);
  let digest = params.digest;

  let processed = 0;

  // Analyses run through an adaptive pool: parallel against a provider that
  // allows it, and settling into the old serial loop against one that does
  // not — see runAdaptivePool. Dequeues are serialised through a single chain
  // because each one is a read-modify-write of the same row, and two workers
  // finishing together would otherwise resurrect each other's dequeued paper.
  let dequeueChain: Promise<void> = Promise.resolve();
  function dequeue(paperId: string): Promise<void> {
    dequeueChain = dequeueChain.then(async () => {
      digest = await prisma.dailyDigest.update({
        where: { id: digest.id },
        data: { pendingPaperIds: digest.pendingPaperIds.filter((id) => id !== paperId) }
      });
    });
    return dequeueChain;
  }

  const pool = await runAdaptivePool({
    items: digest.pendingPaperIds,
    concurrency: ANALYSIS_CONCURRENCY,
    shouldStop: () => Date.now() + PER_PAPER_MARGIN_MS > opts.deadline,
    handle: async (paperId, isFinalAttempt) => {
      try {
        // Count only papers that actually produced an analysis: `processed`
        // triggers the overview rewrite below, and a paper that returns false
        // every run (nothing to analyse from) must not re-trigger it hourly.
        if (await processPaper({ workspaceId, paperId, llm, topics: prefs.topics, language })) {
          processed += 1;
        }
      } catch (error) {
        if (error instanceof LlmRateLimitError && !isFinalAttempt) {
          // Not dequeued: the pool slows down and hands this paper back out.
          return "rate-limited";
        }
        // Dequeue even when the analysis failed, otherwise this paper would
        // block the digest forever; the next run re-queues what has no
        // analysis and retries it.
        console.error("[daily-digest] analysis failed", paperId, error);
      }
      await dequeue(paperId);
      return "done";
    }
  });
  await dequeueChain;

  if (pool.stopped && digest.pendingPaperIds.length > 0) {
    return { status: "partial", processed, remaining: digest.pendingPaperIds.length };
  }

  const paperRows = await prisma.paper.findMany({ where: { id: { in: digest.paperIds } } });
  const papers = new Map(paperRows.map((paper) => [paper.id, paper]));
  const analyses = await loadAnalyses(workspaceId, digest.paperIds);
  const results = digest.paperIds.flatMap((paperId) => {
    const paper = papers.get(paperId);
    const analysis = analyses.get(paperId);
    return paper && analysis ? [toAnalysisResult(paper, analysis)] : [];
  });

  // A stored overview earns its place only by passing the same completeness
  // judgement a fresh generation must pass: the placeholder fails it (it is
  // what a run writes when every analysis failed, and a later run that
  // recovers them must be able to replace it), and so does a fragment the
  // model cut off mid-sentence — which is how 2026-08-27 shipped half an
  // opening line as the day's briefing. A run that just processed papers
  // rewrites the overview too: an existing one was written before these
  // analyses landed, so it silently covers only the papers that had succeeded
  // by then. (The Feishu card is not re-sent — feishuSentAt guards against a
  // second push — so the improved text only lands in the app.)
  if (!isCompleteOverview(digest.overviewSummary, results.length, language) || processed > 0) {
    let overviewSummary = placeholderOverview(digest.paperIds.length);
    if (results.length > 0) {
      try {
        overviewSummary = await generateOverview(llm, results, prefs.topics, language);
      } catch (error) {
        console.error("[daily-digest] overview failed", error);
      }
    }
    digest = await prisma.dailyDigest.update({
      where: { id: digest.id },
      data: { overviewSummary }
    });
  }

  // Claim before sending: failing to claim feishuSentAt means another run has
  // already sent it (or is sending it), so this run does not push again
  if (webhookUrl && !digest.feishuSentAt && (await claimFeishuSend(digest.id))) {
    const sent = await notifyFeishu({
      webhookUrl,
      date: today,
      digest,
      papers: digestPapers(digest.paperIds, papers, analyses),
      language
    });
    if (!sent) {
      // On a failed push, clear the timestamp again and leave it for the next
      // scan to retry
      await revertFeishuSend(digest.id);
      console.error("[daily-digest] feishu delivery failed, will retry on next run", digest.id);
    }
  }

  return { status: "done", processed, remaining: 0 };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
