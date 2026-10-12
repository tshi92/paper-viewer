import { createHash } from "node:crypto";
import { del, list, put } from "@vercel/blob";
import { prisma } from "@paper-viewer/db";
import { createPdfObjectKey, createS3Client, putPdfObject } from "@paper-viewer/storage/pdf-storage";
import { getEnv, getS3Config } from "@/lib/env";
import { hasStoredPdf } from "@/lib/paper-pdf";

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
    // A hung download must fail (snapshotting is best-effort) rather than eat
    // the serverless function's whole time budget.
    signal: AbortSignal.timeout(60_000),
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
  if (hasStoredPdf(paper)) {
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

/**
 * A snapshot of a paper no workspace has saved is only a cache: nothing anchors
 * to it, and the viewer reads the live copy without it. It is kept as long as
 * the Today page lists a digest (7 days), so a digest paper saved from there is
 * already pinned; an older one is pinned again on its next open or save.
 */
const UNSAVED_SNAPSHOT_DAYS = 7;
const SNAPSHOT_PREFIX = "papers/";
/** URLs per del() call; each one still counts against Blob's operation rate limit. */
const DELETE_BATCH = 100;

export type SnapshotBlob = { url: string; pathname: string; size: number; uploadedAt: Date };

/** The paper a blob belongs to: snapshots and uploads are both stored at papers/{paperId}/{sha256}.pdf. */
export function snapshotPaperId(pathname: string): string | null {
  return /^papers\/([^/]+)\/[^/]+\.pdf$/.exec(pathname)?.[1] ?? null;
}

/**
 * The snapshots to delete: older than the window, of a paper no workspace has
 * saved. An archived row counts as saved, since its annotations still anchor
 * to the bytes and the paper can be put back. A blob not named like a snapshot
 * is never touched.
 */
export function expiredSnapshots(
  blobs: SnapshotBlob[],
  savedPaperIds: ReadonlySet<string>,
  now: Date
): SnapshotBlob[] {
  const cutoff = now.getTime() - UNSAVED_SNAPSHOT_DAYS * 86_400_000;
  return blobs.filter((blob) => {
    const paperId = snapshotPaperId(blob.pathname);
    return paperId !== null && !savedPaperIds.has(paperId) && blob.uploadedAt.getTime() < cutoff;
  });
}

async function listSnapshots(token: string): Promise<SnapshotBlob[]> {
  const blobs: SnapshotBlob[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix: SNAPSHOT_PREFIX, token, ...(cursor ? { cursor } : {}) });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return blobs;
}

export type PruneResult = { listed: number; deleted: number; freedBytes: number };

/**
 * Delete the expired snapshots (see expiredSnapshots). Papers let go of a URL
 * before its blob goes, so a failed delete leaves an orphan that the next run
 * lists and deletes again, never a paper pointing at a missing file.
 * Null when this deployment has no Blob store.
 */
export async function pruneSnapshots(now = new Date()): Promise<PruneResult | null> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return null;
  }

  const blobs = await listSnapshots(token);
  const paperIds = [...new Set(blobs.map((blob) => snapshotPaperId(blob.pathname)).filter((id) => id !== null))];
  const saved = await prisma.workspacePaper.findMany({
    where: { paperId: { in: paperIds } },
    select: { paperId: true },
    distinct: ["paperId"]
  });
  const expired = expiredSnapshots(blobs, new Set(saved.map((row) => row.paperId)), now);

  for (let start = 0; start < expired.length; start += DELETE_BATCH) {
    const urls = expired.slice(start, start + DELETE_BATCH).map((blob) => blob.url);
    await prisma.paper.updateMany({ where: { blobUrl: { in: urls } }, data: { blobUrl: null } });
    await del(urls, { token });
  }
  return {
    listed: blobs.length,
    deleted: expired.length,
    freedBytes: expired.reduce((sum, blob) => sum + blob.size, 0)
  };
}
