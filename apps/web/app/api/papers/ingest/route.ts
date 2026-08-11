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
 * `overviewSummary` 保留在 schema 里只为兼容老调用方的请求体，服务端已不再消费：
 * DailyDigest 现在完全归每日管道（cron / discover）所有，见下方 POST 里的说明。
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
  // 未配置 LLM 时降级为直接用 keywords 当 tags，不阻断 ingest。
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

  // 这里刻意不写 DailyDigest：那一行归每日管道（cron / discover）所有。
  // 外部 ingest 一旦抢先建行，当天的管道会把它当成「已经建过」，pending 为空、
  // 总览非空 → 直接判 done，真正的每日推荐就被顶掉了；反过来 ingest 也可能
  // 覆盖掉管道刚写好的总览。ingest 的论文照常落 Paper + WorkspacePaper，
  // 在 Library 里可见可读，只是不参与当天的 digest 卡片。

  return Response.json({
    ok: true,
    date,
    ingested: results.length,
    papers: results
  });
}
