import { validatePdfUpload } from "@paper-viewer/core/upload-validation";
import { prisma } from "@paper-viewer/db";
import { createPdfObjectKey, createS3Client, putPdfObject } from "@paper-viewer/storage/pdf-storage";
import { createHash } from "node:crypto";
import { requireCurrentUser } from "@/lib/auth";
import { getEnv, getS3Config } from "@/lib/env";

type PaperMetadata = {
  title: string;
  authors: string[];
  abstract: string;
  summary: string;
  keywords: string[];
};

async function extractMetadataViaLlm(
  bytes: Uint8Array,
  fileName: string,
  env: { LLM_API_KEY: string; LLM_BASE_URL: string; LLM_MODEL: string }
): Promise<PaperMetadata> {
  // Upload PDF to Kimi Files API for text extraction
  const uploadForm = new FormData();
  uploadForm.append("file", new Blob([bytes], { type: "application/pdf" }), fileName);
  uploadForm.append("purpose", "file-extract");

  const uploadRes = await fetch(`${env.LLM_BASE_URL}/files`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.LLM_API_KEY}` },
    body: uploadForm
  });

  if (!uploadRes.ok) {
    throw new Error(`File upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  const fileData = await uploadRes.json() as { id: string };
  const fileId = fileData.id;

  // Get extracted text content
  const contentRes = await fetch(`${env.LLM_BASE_URL}/files/${fileId}/content`, {
    headers: { "Authorization": `Bearer ${env.LLM_API_KEY}` }
  });

  const fileContent = contentRes.ok ? await contentRes.text() : "";

  if (!fileContent) {
    throw new Error("Failed to extract text from PDF");
  }

  // Ask LLM to extract metadata from the content
  const response = await fetch(`${env.LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.LLM_API_KEY}`
    },
    body: JSON.stringify({
      model: env.LLM_MODEL,
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
  "keywords": ["keyword1", "keyword2", "keyword3"]
}`
        }
      ],
      temperature: 0.1,
      max_tokens: 3000,
      response_format: { type: "json_object" }
    })
  });

  // Clean up uploaded file (fire and forget)
  fetch(`${env.LLM_BASE_URL}/files/${fileId}`, {
    method: "DELETE",
    headers: { "Authorization": `Bearer ${env.LLM_API_KEY}` }
  }).catch(() => {});

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

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  const env = getEnv();
  const formData = await request.formData();
  const file = formData.get("pdf");

  if (!(file instanceof File)) {
    return new Response("PDF file is required", { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validatePdfUpload({
    fileName: file.name,
    contentType: file.type,
    byteLength: bytes.byteLength,
    maxBytes: env.MAX_PDF_UPLOAD_MB * 1024 * 1024
  });

  if (!validation.ok) {
    return new Response(validation.reason, { status: 400 });
  }

  // Extract metadata via LLM (upload PDF → extract text → analyze)
  let metadata: PaperMetadata;
  try {
    metadata = await extractMetadataViaLlm(bytes, file.name, env);
  } catch {
    metadata = {
      title: file.name.replace(/\.pdf$/i, ""),
      authors: [],
      abstract: "",
      summary: "",
      keywords: []
    };
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const paper = await prisma.paper.create({
    data: {
      title: metadata.title,
      abstract: metadata.abstract || null,
      authors: metadata.authors,
      source: "manual",
      workspacePapers: {
        create: {
          workspaceId: user.workspaceId,
          importedById: user.id,
          tags: metadata.keywords
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
        model: "kimi"
      }
    });
  }

  const s3 = getS3Config();
  if (s3) {
    const objectKey = createPdfObjectKey({
      workspaceId: user.workspaceId,
      paperId: paper.id,
      sha256
    });

    const client = createS3Client(s3);
    await putPdfObject({ client, bucket: s3.bucket, key: objectKey, body: bytes, contentType: "application/pdf" });
    await prisma.paperFile.create({
      data: {
        paperId: paper.id,
        objectKey,
        fileName: file.name,
        contentType: "application/pdf",
        byteLength: bytes.byteLength,
        sha256,
        status: "ready"
      }
    });
  }

  return Response.json({ ok: true, paperId: paper.id });
}
