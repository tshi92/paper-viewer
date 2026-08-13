import { validatePdfUpload } from "@paper-viewer/core/upload-validation";
import { prisma } from "@paper-viewer/db";
import { createPdfObjectKey, createS3Client, putPdfObject } from "@paper-viewer/storage/pdf-storage";
import { put } from "@vercel/blob";
import { createHash } from "node:crypto";
import { fetchArxivMetadata } from "@/lib/arxiv";
import { requireCurrentUser } from "@/lib/auth";
import { getEnv, getS3Config } from "@/lib/env";
import { findLibraryDuplicate } from "@/lib/library-dedup";
import { resolveLlmConfig, type LlmRuntimeConfig } from "@/lib/llm-config";
import { getExistingTopics, assignTopics } from "@/lib/topics";
import { extractPdfText } from "@/lib/pdf-extract";

type PaperMetadata = {
  title: string;
  authors: string[];
  abstract: string;
  summary: string;
  keywords: string[];
};

function parseArxivId(url: string): string | null {
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/);
  return m ? m[1]! : null;
}

/**
 * Publisher sites whose bot protection rejects every server-side download
 * (403 regardless of user agent — verified against dl.acm.org). A human in a
 * browser can open these fine, so the client turns this into an actionable
 * "download it yourself and upload the file" message instead of a bare 403.
 */
const BLOCKED_PDF_HOSTS = ["dl.acm.org", "ieeexplore.ieee.org"];

function isBlockedPdfHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return BLOCKED_PDF_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
  } catch {
    return false;
  }
}

async function fetchPdfFromUrl(url: string): Promise<{ bytes: Uint8Array; fileName: string; arxivId: string | null; sourceUrl: string }> {
  let pdfUrl = url;
  const arxivId = parseArxivId(url);

  if (arxivId) {
    pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
  }

  const res = await fetch(pdfUrl, { redirect: "follow" });
  if (!res.ok) {
    throw new Error(`Failed to fetch PDF: ${res.status}`);
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  const fileName = arxivId ? `${arxivId}.pdf` : (pdfUrl.split("/").pop() || "paper.pdf");

  return { bytes, fileName, arxivId, sourceUrl: pdfUrl };
}

async function extractMetadataViaLlm(
  bytes: Uint8Array,
  _fileName: string,
  config: LlmRuntimeConfig
): Promise<PaperMetadata> {
  const fileContent = await extractPdfText(bytes);

  if (!fileContent) {
    throw new Error("Failed to extract text from PDF");
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "你是一个学术论文元数据提取助手。始终返回纯 JSON。"
        },
        {
          role: "system",
          content: fileContent.slice(0, 10000)
        },
        {
          role: "user",
          content: `请从上面的论文内容中提取元数据。

重要要求：
1. authors 必须包含论文中列出的所有作者，不要遗漏
2. title 使用论文的英文原标题
3. abstract 使用论文的英文原文摘要

返回 JSON：
{
  "title": "论文完整标题（英文原文）",
  "authors": ["Author1 Full Name", "Author2 Full Name", "...每一个作者"],
  "abstract": "完整的英文摘要",
  "summary": "论文核心内容概述（中文，3-5句话）",
  "keywords": ["english keyword1", "english keyword2", "english keyword3"]
}

注意：keywords 必须用英文，小写，简洁（1-4个词）。`
        }
      ],
      max_tokens: 16000,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    throw new Error(`LLM API error: ${response.status}`);
  }

  const data = await response.json() as { choices: { message: { content: string } }[] };
  let jsonStr = data.choices[0]!.message.content.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(jsonStr);
}

/**
 * Persist the uploaded bytes wherever this deployment stores PDFs: S3/MinIO
 * when configured (local dev), Vercel Blob otherwise (production). Previously
 * only the S3 path existed, so direct uploads on production silently dropped
 * the file.
 */
async function storePdfBytes(params: {
  workspaceId: string;
  paperId: string;
  bytes: Uint8Array;
  sha256: string;
  fileName: string;
}): Promise<void> {
  const { workspaceId, paperId, bytes, sha256, fileName } = params;

  const s3 = getS3Config();
  if (s3) {
    const objectKey = createPdfObjectKey({ workspaceId, paperId, sha256 });
    const client = createS3Client(s3);
    await putPdfObject({ client, bucket: s3.bucket, key: objectKey, body: bytes, contentType: "application/pdf" });
    await prisma.paperFile.create({
      data: {
        paperId,
        objectKey,
        fileName,
        contentType: "application/pdf",
        byteLength: bytes.byteLength,
        sha256,
        status: "ready"
      }
    });
    return;
  }

  const env = getEnv();
  if (env.BLOB_READ_WRITE_TOKEN) {
    // Same path and access mode as lib/pdf-snapshot.ts: URLs carry an
    // unguessable hash and are never handed out directly.
    const blob = await put(`papers/${paperId}/${sha256}.pdf`, Buffer.from(bytes), {
      access: "public",
      contentType: "application/pdf",
      allowOverwrite: true,
      token: env.BLOB_READ_WRITE_TOKEN
    });
    await prisma.paper.update({ where: { id: paperId }, data: { blobUrl: blob.url } });
  }
}

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  const env = getEnv();

  const contentType = request.headers.get("content-type") || "";

  let bytes: Uint8Array;
  let fileName: string;
  let arxivId: string | null = null;
  let pdfUrl: string | null = null;

  if (contentType.includes("application/json")) {
    const body = await request.json() as { url?: string };
    const url = body.url?.trim();
    if (!url) {
      return new Response("URL is required", { status: 400 });
    }

    if (isBlockedPdfHost(url)) {
      return Response.json({ error: "publisher_blocked" }, { status: 400 });
    }

    try {
      const result = await fetchPdfFromUrl(url);
      bytes = result.bytes;
      fileName = result.fileName;
      arxivId = result.arxivId;
      pdfUrl = result.sourceUrl;
    } catch (e) {
      return new Response(e instanceof Error ? e.message : "Failed to fetch PDF", { status: 400 });
    }

    if (bytes.byteLength > env.MAX_PDF_UPLOAD_MB * 1024 * 1024) {
      return new Response(`PDF exceeds ${env.MAX_PDF_UPLOAD_MB}MB limit`, { status: 400 });
    }
  } else {
    const formData = await request.formData();
    const file = formData.get("pdf");

    if (!(file instanceof File)) {
      return new Response("PDF file is required", { status: 400 });
    }

    bytes = new Uint8Array(await file.arrayBuffer());
    fileName = file.name;

    const validation = validatePdfUpload({
      fileName: file.name,
      contentType: file.type,
      byteLength: bytes.byteLength,
      maxBytes: env.MAX_PDF_UPLOAD_MB * 1024 * 1024
    });

    if (!validation.ok) {
      return new Response(validation.reason, { status: 400 });
    }
  }

  // If arxiv URL, check for existing paper to avoid duplicates
  if (arxivId) {
    const existing = await prisma.workspacePaper.findFirst({
      where: {
        workspaceId: user.workspaceId,
        paper: { arxivId },
        state: "visible"
      }
    });
    if (existing) {
      return Response.json({ ok: true, paperId: existing.paperId });
    }
  }

  // Resolve the LLM configuration once (DB first, env as fallback); it is null when
  // unconfigured, and metadata and topics each degrade softly on their own.
  const llm = await resolveLlmConfig(user.workspaceId).catch(() => null);

  // arXiv papers prefer metadata from the official API (free, authoritative, no LLM
  // needed); LLM extraction only serves non-arXiv PDFs.
  let metadata: PaperMetadata;
  let publishedAt: Date | null = null;
  const arxivMeta = arxivId ? await fetchArxivMetadata(arxivId).catch(() => null) : null;
  if (arxivMeta) {
    metadata = {
      title: arxivMeta.title,
      authors: arxivMeta.authors,
      abstract: arxivMeta.abstract,
      summary: "",
      keywords: []
    };
    publishedAt = arxivMeta.publishedAt ? new Date(arxivMeta.publishedAt) : null;
  } else {
    try {
      if (!llm) throw new Error("LLM not configured");
      metadata = await extractMetadataViaLlm(bytes, fileName, llm);
    } catch {
      metadata = {
        title: fileName.replace(/\.pdf$/i, ""),
        authors: [],
        abstract: "",
        summary: "",
        keywords: []
      };
    }
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // The same article must never enter the library twice, whichever door it
  // comes through — this mirrors the save button's check. When the duplicate
  // sits in the library WITHOUT a PDF (a saved conference row, typically),
  // uploading its PDF really means "give that paper the file": attach the
  // bytes to the existing row instead of creating a twin.
  const duplicateId = await findLibraryDuplicate(user.workspaceId, {
    title: metadata.title,
    arxivId
  });
  if (duplicateId) {
    const duplicate = await prisma.paper.findUnique({
      where: { id: duplicateId },
      select: {
        pdfUrl: true,
        blobUrl: true,
        arxivId: true,
        files: { select: { id: true }, take: 1 }
      }
    });
    const hasPdf =
      duplicate !== null &&
      (duplicate.pdfUrl !== null ||
        duplicate.blobUrl !== null ||
        duplicate.arxivId !== null ||
        duplicate.files.length > 0);
    if (!hasPdf) {
      try {
        await storePdfBytes({ workspaceId: user.workspaceId, paperId: duplicateId, bytes, sha256, fileName });
        if (pdfUrl) {
          await prisma.paper.update({ where: { id: duplicateId }, data: { pdfUrl } });
        }
      } catch (error) {
        // Attaching is best-effort; pointing at the existing row still beats a twin.
        console.error("[upload] attaching pdf to existing paper failed", duplicateId, error);
      }
    }
    return Response.json({ ok: true, paperId: duplicateId, duplicate: true });
  }

  const existingTopics = await getExistingTopics(user.workspaceId);
  let topics: string[];
  try {
    if (!llm) throw new Error("LLM not configured");
    topics = await assignTopics({
      config: llm,
      title: metadata.title,
      abstract: metadata.abstract,
      keywords: metadata.keywords,
      existingTopics
    });
  } catch {
    topics = metadata.keywords.slice(0, 3);
  }

  const paper = await prisma.paper.create({
    data: {
      title: metadata.title,
      abstract: metadata.abstract || null,
      authors: metadata.authors,
      source: arxivId ? "arxiv" : "manual",
      ...(publishedAt ? { publishedAt } : {}),
      ...(arxivId ? { arxivId } : {}),
      ...(pdfUrl ? { pdfUrl } : {}),
      workspacePapers: {
        create: {
          workspaceId: user.workspaceId,
          importedById: user.id,
          tags: topics
        }
      }
    }
  });

  if (metadata.summary) {
    await prisma.paperAnalysis.create({
      data: {
        paperId: paper.id,
        workspaceId: user.workspaceId,
        summary: metadata.summary,
        keywords: metadata.keywords,
        model: "deepseek"
      }
    });
  }

  try {
    await storePdfBytes({ workspaceId: user.workspaceId, paperId: paper.id, bytes, sha256, fileName });
  } catch (error) {
    // The paper row is already useful without the file (metadata, analysis);
    // the PDF can be re-attached by uploading again.
    console.error("[upload] storing pdf failed", paper.id, error);
  }

  return Response.json({ ok: true, paperId: paper.id });
}
