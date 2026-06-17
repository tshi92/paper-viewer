import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";
import { fetchArxivPapers } from "@/lib/arxiv";
import { selectPapers, analyzeSinglePaper, generateOverview, type PaperAnalysisResult } from "@/lib/llm";
import { getExistingTopics, assignTopics } from "@/lib/topics";

export const maxDuration = 120;

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

  // Step 3: Analyze each paper individually (in parallel, batches of 3)
  const analyses: PaperAnalysisResult[] = [];
  for (let i = 0; i < selectedPapers.length; i += 3) {
    const batch = selectedPapers.slice(i, i + 3);
    const batchResults = await Promise.all(
      batch.map((p) => analyzeSinglePaper(p!, topics).catch(() => null))
    );
    for (const r of batchResults) {
      if (r) analyses.push(r);
    }
  }

  if (analyses.length === 0) {
    return Response.json({ error: "Paper analysis failed" }, { status: 500 });
  }

  // Step 4: Generate overview
  let overviewSummary: string;
  try {
    overviewSummary = await generateOverview(analyses, topics);
  } catch {
    overviewSummary = `今日推荐 ${analyses.length} 篇论文。`;
  }

  // Step 5: Store results
  const today = new Date().toISOString().slice(0, 10);
  const paperIds: string[] = [];
  const existingTopics = await getExistingTopics(user.workspaceId);

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

    // Assign normalized topics
    let paperTopics: string[];
    try {
      paperTopics = await assignTopics({
        title: entry.title,
        abstract: candidates.find((c) => c.arxivId === entry.arxivId)?.abstract ?? "",
        keywords: entry.keywords,
        existingTopics
      });
      for (const t of paperTopics) {
        if (!existingTopics.includes(t)) existingTopics.push(t);
      }
    } catch {
      paperTopics = entry.keywords.slice(0, 3);
    }

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
        model: "kimi"
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
