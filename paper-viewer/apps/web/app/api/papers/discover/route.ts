import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";
import { fetchArxivPapers } from "@/lib/arxiv";
import { analyzeAndRankPapers } from "@/lib/llm";

export async function POST() {
  const user = await requireCurrentUser();

  // Get workspace preferences
  const prefs = await prisma.researchPreferences.findUnique({
    where: { workspaceId: user.workspaceId }
  });

  const topics = prefs?.topics ?? [];
  const keywords = prefs?.keywords ?? [];
  const excludedTopics = prefs?.excludedTopics ?? [];
  const arxivCategories = prefs?.arxivCategories.length ? prefs.arxivCategories : ["cs.AI", "cs.CL", "cs.LG"];
  const papersPerDay = prefs?.papersPerDay ?? 10;

  // Fetch candidate papers from arXiv
  const candidates = await fetchArxivPapers({
    categories: arxivCategories,
    keywords,
    maxResults: Math.max(papersPerDay * 4, 40)
  });

  if (candidates.length === 0) {
    return Response.json({ error: "No papers found from arXiv" }, { status: 404 });
  }

  // LLM analysis and ranking
  const analysis = await analyzeAndRankPapers({
    papers: candidates,
    topics,
    keywords,
    excludedTopics,
    papersPerDay
  });

  // Store results
  const today = new Date().toISOString().slice(0, 10);
  const paperIds: string[] = [];

  for (const entry of analysis.papers) {
    // Dedup by arxivId
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

    // Ensure WorkspacePaper
    await prisma.workspacePaper.upsert({
      where: {
        workspaceId_paperId: {
          workspaceId: user.workspaceId,
          paperId: paper.id
        }
      },
      update: {},
      create: {
        workspaceId: user.workspaceId,
        paperId: paper.id,
        tags: entry.keywords
      }
    });

    // Store analysis
    await prisma.paperAnalysis.create({
      data: {
        paperId: paper.id,
        workspaceId: user.workspaceId,
        summary: entry.summary,
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
    update: {
      overviewSummary: analysis.overviewSummary,
      paperIds
    },
    create: {
      workspaceId: user.workspaceId,
      date: digestDate,
      overviewSummary: analysis.overviewSummary,
      paperIds
    }
  });

  return Response.json({
    ok: true,
    date: today,
    discovered: analysis.papers.length
  });
}
