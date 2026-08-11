import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";
import { fetchArxivPapers } from "@/lib/arxiv";
import { selectPapers, analyzeSinglePaper, generateOverview, type PaperAnalysisResult } from "@/lib/llm";
import { resolveLlmConfig, type LlmRuntimeConfig } from "@/lib/llm-config";

export const maxDuration = 300;

export async function POST() {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const prefs = await prisma.researchPreferences.findUnique({
    where: { workspaceId: user.workspaceId }
  });

  const topics = prefs?.topics ?? [];
  const keywords = prefs?.keywords ?? [];
  const excludedTopics = prefs?.excludedTopics ?? [];
  const arxivCategories = prefs?.arxivCategories.length ? prefs.arxivCategories : ["cs.AI", "cs.CL", "cs.LG"];
  const papersPerDay = prefs?.papersPerDay ?? 10;

  let llm: LlmRuntimeConfig;
  try {
    llm = await resolveLlmConfig(user.workspaceId);
  } catch {
    return Response.json({ error: "LLM 未配置，请在设置页配置" }, { status: 502 });
  }

  // Step 1: Fetch candidates from arXiv
  let candidates;
  try {
    candidates = await fetchArxivPapers({
      categories: arxivCategories,
      keywords,
      maxResults: Math.max(papersPerDay * 4, 30)
    });
  } catch (err) {
    return Response.json({ error: `arXiv fetch failed: ${err instanceof Error ? err.message : "unknown"}` }, { status: 502 });
  }

  if (candidates.length === 0) {
    return Response.json({ error: "No papers found from arXiv" }, { status: 404 });
  }

  // Step 2: LLM selects most relevant papers
  let selectedIds: string[];
  try {
    selectedIds = await selectPapers({
      config: llm,
      papers: candidates,
      topics,
      keywords,
      excludedTopics,
      papersPerDay
    });
  } catch (err) {
    return Response.json({ error: `Paper selection failed: ${err instanceof Error ? err.message : "unknown"}` }, { status: 500 });
  }

  const selectedPapers = selectedIds
    .map((id) => candidates.find((c) => c.arxivId === id))
    .filter(Boolean);

  if (selectedPapers.length === 0) {
    return Response.json({ error: "No papers selected" }, { status: 500 });
  }

  // Step 3: Analyze each paper sequentially (avoid LLM rate limits)
  const analyses: PaperAnalysisResult[] = [];
  for (const p of selectedPapers) {
    try {
      const result = await analyzeSinglePaper(llm, p!, topics);
      analyses.push(result);
    } catch {
      // skip failed analysis, continue with remaining papers
    }
  }

  if (analyses.length === 0) {
    return Response.json({ error: "Paper analysis failed" }, { status: 500 });
  }

  // Step 4: Generate overview
  let overviewSummary: string;
  try {
    overviewSummary = await generateOverview(llm, analyses, topics);
  } catch {
    overviewSummary = `今日推荐 ${analyses.length} 篇论文。`;
  }

  // Step 5: Store results (use analysis keywords as tags directly, skip extra LLM calls)
  const today = new Date().toISOString().slice(0, 10);
  const paperIds: string[] = [];

  for (const entry of analyses) {
    if (!entry) continue;

    let paper = await prisma.paper.findUnique({
      where: { arxivId: entry.arxivId }
    });

    if (!paper) {
      const candidate = candidates.find((c) => c.arxivId === entry.arxivId);
      paper = await prisma.paper.create({
        data: {
          title: entry.title,
          abstract: candidate?.abstract ?? null,
          authors: candidate?.authors ?? [],
          source: "arxiv",
          sourceId: entry.arxivId,
          arxivId: entry.arxivId,
          publishedAt: candidate?.publishedAt ? new Date(candidate.publishedAt) : null
        }
      });
    }

    paperIds.push(paper.id);

    const paperTopics = entry.keywords.slice(0, 3);

    await prisma.workspacePaper.upsert({
      where: {
        workspaceId_paperId: {
          workspaceId: user.workspaceId,
          paperId: paper.id
        }
      },
      update: { tags: paperTopics },
      create: {
        workspaceId: user.workspaceId,
        paperId: paper.id,
        tags: paperTopics
      }
    });

    await prisma.paperAnalysis.create({
      data: {
        paperId: paper.id,
        workspaceId: user.workspaceId,
        summary: entry.summary,
        motivation: entry.motivation,
        problem: entry.problem,
        method: entry.method,
        keyFindings: entry.keyFindings,
        whyItMatters: entry.whyItMatters,
        keywords: entry.keywords,
        model: "deepseek"
      }
    });
  }

  // Create daily digest
  const digestDate = new Date(today + "T00:00:00Z");
  await prisma.dailyDigest.upsert({
    where: {
      workspaceId_date: {
        workspaceId: user.workspaceId,
        date: digestDate
      }
    },
    update: { overviewSummary, paperIds },
    create: {
      workspaceId: user.workspaceId,
      date: digestDate,
      overviewSummary,
      paperIds
    }
  });

  return Response.json({
    ok: true,
    date: today,
    discovered: analyses.length
  });
}
