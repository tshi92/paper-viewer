import { prisma } from "@paper-viewer/db";
import { createS3Client, getPdfObject } from "@paper-viewer/storage/pdf-storage";
import { getS3Config } from "@/lib/env";
import { extractPdfText } from "@/lib/pdf-extract";

const FETCH_TIMEOUT_MS = 20_000;
// PaperFileExtract 只做缓存，超长正文截断入库；本次调用仍返回完整文本
const CACHE_MAX_CHARS = 100_000;

async function readAllBytes(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array | null> {
  if (!body) {
    return null;
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
  return chunks.length > 0 ? Buffer.concat(chunks) : null;
}

/**
 * 逐块读取而不是 res.arrayBuffer()：后者在 Next dev 的服务端渲染里对几 MB 的响应
 * 会触发 "Maximum call stack size exceeded"（见 pdf-snapshot.ts 的同款处理）。
 */
async function downloadBytes(url: string): Promise<Uint8Array | null> {
  const res = await fetch(url, {
    headers: { "User-Agent": "PaperViewer/1.0" },
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) {
    return null;
  }
  return readAllBytes(res.body);
}

async function readFromObjectStorage(objectKey: string): Promise<Uint8Array | null> {
  const s3 = getS3Config();
  if (!s3) {
    return null;
  }
  const client = createS3Client(s3);
  const object = await getPdfObject({ client, bucket: s3.bucket, key: objectKey });
  const bytes = await object.Body?.transformToByteArray();
  return bytes ?? null;
}

type PaperSource = {
  arxivId: string | null;
  blobUrl: string | null;
  files: { objectKey: string }[];
};

/** 依次尝试各获取渠道，任一渠道抛错都落到下一个 */
async function loadPdfBytes(paper: PaperSource): Promise<Uint8Array | null> {
  const attempts: (() => Promise<Uint8Array | null>)[] = [];

  const file = paper.files[0];
  if (file) {
    attempts.push(() => readFromObjectStorage(file.objectKey));
  }
  if (paper.blobUrl) {
    attempts.push(() => downloadBytes(paper.blobUrl as string));
  }
  if (paper.arxivId) {
    attempts.push(() => downloadBytes(`https://arxiv.org/pdf/${paper.arxivId}`));
  }

  for (const attempt of attempts) {
    try {
      const bytes = await attempt();
      if (bytes && bytes.byteLength > 0) {
        return bytes;
      }
    } catch {
      // 换下一个渠道
    }
  }
  return null;
}

/**
 * 统一论文全文获取。顺序：
 *   PaperFileExtract 缓存 → PaperFile(S3/MinIO) → Paper.blobUrl → arXiv(https)
 *   → extractPdfText(unpdf) → upsert 缓存 → 返回文本
 * 全部失败返回 null；绝不抛出。
 * 调用方需自行校验论文属于当前 workspace——本函数只按 paperId 取数据。
 */
export async function getPaperText(paperId: string): Promise<string | null> {
  try {
    const cached = await prisma.paperFileExtract.findUnique({ where: { paperId } });
    if (cached) {
      return cached.textContent;
    }

    const paper = await prisma.paper.findUnique({
      where: { id: paperId },
      include: { files: { orderBy: { createdAt: "desc" }, take: 1 } }
    });
    if (!paper) {
      return null;
    }

    const bytes = await loadPdfBytes(paper);
    if (!bytes) {
      return null;
    }

    let text: string;
    try {
      // 部分 PDF 抽出的文本带 NUL 字符，Postgres 的 UTF8 编码会直接拒收
      text = (await extractPdfText(bytes)).replaceAll("\u0000", "");
    } catch {
      return null;
    }
    if (!text.trim()) {
      return null;
    }

    const textContent = text.slice(0, CACHE_MAX_CHARS);
    try {
      await prisma.paperFileExtract.upsert({
        where: { paperId },
        update: { textContent },
        create: { paperId, textContent }
      });
    } catch {
      // 缓存写失败不影响本次结果，下次重新抽取即可
    }

    return text;
  } catch {
    return null;
  }
}
