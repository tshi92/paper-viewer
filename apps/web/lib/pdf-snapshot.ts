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
  // Without the magic number, only trust a response header that explicitly says
  // pdf (some mirror sites forget to send the header)
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
    // A PDF of several MB has no business in Next's fetch data cache
    cache: "no-store"
  });
  if (!res.ok) {
    return null;
  }

  // Read chunk by chunk rather than via res.arrayBuffer(): the latter triggers
  // "Maximum call stack size exceeded" on responses of a few MB during Next dev's
  // RSC rendering and breaks the HTML stream.
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
 * Ensure the paper has a pinned PDF snapshot (so annotation anchors do not drift
 * when arXiv publishes an update).
 * Priority: existing snapshot (PaperFile or blobUrl) → Blob (production) →
 * S3/MinIO (local) → give up (fall back to the arXiv proxy).
 * Idempotent, so it is safe to call when the page opens.
 * The caller must first verify the paper belongs to the current workspace — this
 * function only looks data up by paperId.
 * The return value says whether the paper has a usable snapshot once the call ends.
 */
export async function ensurePdfSnapshot(paperId: string, workspaceId: string): Promise<boolean> {
  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: { files: { take: 1 } }
  });
  if (!paper) {
    return false;
  }
  if (paper.files.length > 0 || paper.blobUrl) {
    return true;
  }

  const sourceUrl = paper.arxivId ? `https://arxiv.org/pdf/${paper.arxivId}` : paper.pdfUrl;
  if (!sourceUrl) {
    return false;
  }

  const env = getEnv();
  const s3 = getS3Config();
  // With neither backend configured there is no point wasting a download
  if (!env.BLOB_READ_WRITE_TOKEN && !s3) {
    return false;
  }

  const bytes = await downloadPdf(sourceUrl);
  if (!bytes) {
    return false;
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
    return true;
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
    return true;
  }

  return false;
}
