import { createHash } from "node:crypto";
import { put } from "@vercel/blob";
import { prisma } from "@paper-viewer/db";
import { createPdfObjectKey, createS3Client, putPdfObject } from "@paper-viewer/storage/pdf-storage";
import { getEnv, getS3Config } from "@/lib/env";

const MIN_PDF_BYTES = 1024;
const PDF_MAGIC = "%PDF";

function looksLikePdf(bytes: Uint8Array, contentType: string | null): boolean {
  const hasMagic = Buffer.from(bytes.subarray(0, PDF_MAGIC.length)).toString("latin1") === PDF_MAGIC;
  if (hasMagic) {
    return true;
  }
  // 没有魔数时只信任明确声明 pdf 的响应头（有些镜像站会漏发 header）
  return contentType ? contentType.toLowerCase().includes("pdf") : false;
}

async function readAllBytes(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks);
}

async function downloadPdf(sourceUrl: string): Promise<Uint8Array | null> {
  const res = await fetch(sourceUrl, {
    headers: { "User-Agent": "PaperViewer/1.0" },
    redirect: "follow",
    // 数 MB 的 PDF 不该进 Next 的 fetch 数据缓存
    cache: "no-store"
  });
  if (!res.ok) {
    return null;
  }

  // 逐块读取而不是 res.arrayBuffer()：后者在 Next dev 的 RSC 渲染里对几 MB 的响应
  // 会触发 "Maximum call stack size exceeded" 并打断 HTML 流。
  const bytes = await readAllBytes(res.body);
  if (bytes.byteLength < MIN_PDF_BYTES) {
    return null;
  }
  if (!looksLikePdf(bytes, res.headers.get("content-type"))) {
    return null;
  }
  return bytes;
}

/**
 * 确保论文有固化 PDF 快照（标注锚定不随 arXiv 更新漂移）。
 * 优先级：已有快照(PaperFile 或 blobUrl) → Blob(生产) → S3/MinIO(本地) → 放弃(降级 arXiv 代理)。
 * 幂等，可在页面打开时安全调用。
 */
export async function ensurePdfSnapshot(paperId: string, workspaceId: string): Promise<void> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: { files: { take: 1 } }
  });
  if (!paper || paper.files.length > 0 || paper.blobUrl) {
    return;
  }

  const sourceUrl = paper.arxivId ? `https://arxiv.org/pdf/${paper.arxivId}` : paper.pdfUrl;
  if (!sourceUrl) {
    return;
  }

  const env = getEnv();
  const s3 = getS3Config();
  // 两种后端都没配置时不必浪费一次下载
  if (!env.BLOB_READ_WRITE_TOKEN && !s3) {
    return;
  }

  const bytes = await downloadPdf(sourceUrl);
  if (!bytes) {
    return;
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  if (env.BLOB_READ_WRITE_TOKEN) {
    const blob = await put(`papers/${paperId}/${sha256}.pdf`, Buffer.from(bytes), {
      access: "public",
      contentType: "application/pdf",
      allowOverwrite: true,
      token: env.BLOB_READ_WRITE_TOKEN
    });
    await prisma.paper.update({ where: { id: paperId }, data: { blobUrl: blob.url } });
    return;
  }

  if (s3) {
    const key = createPdfObjectKey({ workspaceId, paperId, sha256 });
    const client = createS3Client(s3);
    await putPdfObject({
      client,
      bucket: s3.bucket,
      key,
      body: bytes,
      contentType: "application/pdf"
    });
    await prisma.paperFile.create({
      data: {
        paperId,
        objectKey: key,
        fileName: `${paper.arxivId ?? paperId}.pdf`,
        contentType: "application/pdf",
        byteLength: bytes.byteLength,
        sha256,
        status: "ready"
      }
    });
  }
}
