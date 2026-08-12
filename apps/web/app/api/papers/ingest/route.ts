import { prisma } from "@paper-viewer/db";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { resolveLlmConfig } from "@/lib/llm-config";
import { getExistingTopics, assignTopics } from "@/lib/topics";

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

/**
 * `overviewSummary` is kept in the schema only for compatibility with older
 * callers' request bodies; the server no longer consumes it. DailyDigest now
 * belongs entirely to the daily pipeline (cron / discover) — see the note in the
 * POST handler below.
 */
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

  const { date, papers } = parsed.data;

  // Find the first workspace (single-workspace MVP)
  const workspace = await prisma.workspace.findFirst();
  if (!workspace) {
    return Response.json({ error: "No workspace found" }, { status: 500 });
  }

  const results: { paperId: string; title: string; created: boolean }[] = [];
  const existingTopics = await getExistingTopics(workspace.id);
  // With no LLM configured, degrade to using the keywords directly as tags rather
  // than blocking the ingest.
  const llm = await resolveLlmConfig(workspace.id).catch(() => null);

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

    // Assign normalized topics
    let paperTopics: string[];
    try {
      if (!llm) throw new Error("LLM not configured");
      paperTopics = await assignTopics({
        config: llm,
        title: entry.title,
        abstract: entry.abstract ?? "",
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
          workspaceId: workspace.id,
          paperId: paper.id
        }
      },
      update: { tags: paperTopics },
      create: {
        workspaceId: workspace.id,
        paperId: paper.id,
        tags: paperTopics
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

  // DailyDigest is deliberately not written here: that row belongs to the daily
  // pipeline (cron / discover). If an external ingest were to create the row
  // first, that day's pipeline would treat it as already created — pending empty
  // and overview non-empty means it is judged done straight away, which would
  // displace the real daily recommendations. Conversely, an ingest could also
  // overwrite an overview the pipeline had just written. Ingested papers still
  // land in Paper + WorkspacePaper as usual and are visible and readable in the
  // Library; they simply do not take part in that day's digest card.

  return Response.json({
    ok: true,
    date,
    ingested: results.length,
    papers: results
  });
}
