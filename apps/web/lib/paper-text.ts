import { prisma } from "@paper-viewer/db";
import { createS3Client, getPdfObject } from "@paper-viewer/storage/pdf-storage";
import { getS3Config } from "@/lib/env";
import { extractPdfText } from "@/lib/pdf-extract";

const FETCH_TIMEOUT_MS = 20_000;
// PaperFileExtract is only a cache, so over-long text is truncated before being
// stored; this call still returns the complete text
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
 * Read chunk by chunk rather than via res.arrayBuffer(): the latter triggers
 * "Maximum call stack size exceeded" on responses of a few MB during Next dev's
 * server-side rendering (see the same handling in pdf-snapshot.ts).
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

/** Try each retrieval channel in turn; if one throws, fall through to the next */
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
      // Move on to the next channel
    }
  }
  return null;
}

/**
 * Single entry point for fetching a paper's full text. Order:
 *   PaperFileExtract cache → PaperFile(S3/MinIO) → Paper.blobUrl → arXiv(https)
 *   → extractPdfText(unpdf) → upsert the cache → return the text
 * Returns null if everything fails; never throws.
 * The caller must verify itself that the paper belongs to the current workspace —
 * this function only looks data up by paperId.
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
      // Text extracted from some PDFs contains NUL characters, which Postgres's
      // UTF8 encoding rejects outright
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
      // A failed cache write does not affect this call's result; the next call
      // just extracts again
    }

    return text;
  } catch {
    return null;
  }
}
