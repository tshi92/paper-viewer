import { prisma } from "@paper-viewer/db";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";

const paperEntrySchema = z.object({
  title: z.string().min(1),
  authors: z.array(z.string()).default([]),
  abstract: z.string().optional(),
  arxivId: z.string().optional(),
  doi: z.string().optional(),
  url: z.string().url().optional(),
  summary: z.string().min(1),
  problem: z.string().optional(),
  method: z.string().optional(),
  keyFindings: z.string().optional(),
  whyItMatters: z.string().optional(),
  keywords: z.array(z.string()).default([])
});

const ingestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  overviewSummary: z.string().optional(),
  papers: z.array(paperEntrySchema).min(1).max(50)
});

function verifyApiKey(request: Request): boolean {
  const env = getEnv();
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return false;

  const token = auth.slice(7);
  const expected = env.INGEST_API_KEY;
  if (token.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

function extractArxivId(urlOrId: string | undefined): string | null {
  if (!urlOrId) return null;
  const match = urlOrId.match(/(?:arxiv\.org\/abs\/|arxiv:)?([\d.]+)(v\d+)?/i);
  return match ? match[1]! : null;
}

export async function POST(request: Request) {
  if (!verifyApiKey(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ingestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Validation failed", details: parsed.error.issues }, { status: 400 });
  }

  const { date, overviewSummary, papers } = parsed.data;

  // Find the first workspace (single-workspace MVP)
  const workspace = await prisma.workspace.findFirst();
  if (!workspace) {
    return Response.json({ error: "No workspace found" }, { status: 500 });
  }

  const results: { paperId: string; title: string; created: boolean }[] = [];

  for (const entry of papers) {
    const arxivId = extractArxivId(entry.arxivId ?? entry.url) ?? null;

    // Dedup by arxivId or title
    let paper = arxivId
      ? await prisma.paper.findUnique({ where: { arxivId } })
      : null;

    if (!paper) {
      paper = await prisma.paper.findFirst({
        where: { title: entry.title, source: "hermes" }
      });
    }

    const created = !paper;

    if (!paper) {
      paper = await prisma.paper.create({
        data: {
          title: entry.title,
          abstract: entry.abstract ?? null,
          authors: entry.authors,
          source: "hermes",
          sourceId: arxivId,
          arxivId,
          doi: entry.doi ?? null
        }
      });
    }

    // Ensure WorkspacePaper exists
    await prisma.workspacePaper.upsert({
      where: {
        workspaceId_paperId: {
          workspaceId: workspace.id,
          paperId: paper.id
        }
      },
      update: {},
      create: {
        workspaceId: workspace.id,
        paperId: paper.id,
        tags: entry.keywords
      }
    });

    // Create analysis
    await prisma.paperAnalysis.create({
      data: {
        paperId: paper.id,
        workspaceId: workspace.id,
        summary: entry.summary,
        problem: entry.problem ?? null,
        method: entry.method ?? null,
        keyFindings: entry.keyFindings ?? null,
        whyItMatters: entry.whyItMatters ?? null,
        keywords: entry.keywords,
        model: "hermes"
      }
    });

    results.push({ paperId: paper.id, title: entry.title, created });
  }

  // Create or update daily digest
  if (overviewSummary) {
    const digestDate = new Date(date + "T00:00:00Z");
    await prisma.dailyDigest.upsert({
      where: {
        workspaceId_date: {
          workspaceId: workspace.id,
          date: digestDate
        }
      },
      update: {
        overviewSummary,
        paperIds: results.map((r) => r.paperId)
      },
      create: {
        workspaceId: workspace.id,
        date: digestDate,
        overviewSummary,
        paperIds: results.map((r) => r.paperId)
      }
    });
  }

  return Response.json({
    ok: true,
    date,
    ingested: results.length,
    papers: results
  });
}
