import { del, list, put } from "@vercel/blob";
import { getEnv, getS3Config } from "@/lib/env";
import { allPartsPrefix, partIndex, partPathname, partPrefix } from "@/lib/upload-chunks";

/**
 * Server side of chunked upload (see lib/upload-chunks.ts for why it exists).
 * Parts wait in the Blob store between requests, because serverless
 * invocations share no memory or disk; the final request joins them and
 * deletes them.
 */

/** An upload nobody finished within this window is abandoned; the nightly cron deletes its parts. */
const ABANDONED_AFTER_HOURS = 24;

/**
 * Only deployments that store PDFs in Vercel Blob need chunking: those are the
 * ones behind Vercel's body limit. With S3/MinIO configured (local dev) the
 * whole file goes up in one request, as before.
 */
export function chunkedUploadEnabled(): boolean {
  return Boolean(getEnv().BLOB_READ_WRITE_TOKEN) && !getS3Config();
}

export async function savePart(params: {
  userId: string;
  uploadId: string;
  index: number;
  bytes: Buffer;
  token: string;
}): Promise<void> {
  const { userId, uploadId, index, bytes, token } = params;
  await put(partPathname(userId, uploadId, index), bytes, {
    access: "public",
    contentType: "application/octet-stream",
    addRandomSuffix: false,
    allowOverwrite: true,
    token
  });
}

type StoredPart = { url: string; pathname: string; size: number; uploadedAt: Date };

async function listParts(prefix: string, token: string): Promise<StoredPart[]> {
  const parts: StoredPart[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, token, ...(cursor ? { cursor } : {}) });
    parts.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return parts;
}

/** The parts in index order, or null unless they are exactly 0..expectedParts-1. */
function inUploadOrder(parts: StoredPart[], expectedParts: number): StoredPart[] | null {
  const ordered = [...parts].sort((a, b) => (partIndex(a.pathname) ?? -1) - (partIndex(b.pathname) ?? -1));
  const complete =
    ordered.length === expectedParts && ordered.every((stored, index) => partIndex(stored.pathname) === index);
  return complete ? ordered : null;
}

async function downloadPart(stored: StoredPart): Promise<Uint8Array> {
  const res = await fetch(stored.url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Reading upload part failed: ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export type AssembledUpload = { ok: true; bytes: Uint8Array } | { ok: false; reason: string };

/**
 * Join an upload's parts back into the file. The caller passes the
 * authenticated user's id: parts are looked up under it, never under anything
 * the request names.
 */
export async function assembleUpload(params: {
  userId: string;
  uploadId: string;
  expectedParts: number;
  maxBytes: number;
}): Promise<AssembledUpload> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return { ok: false, reason: "Chunked upload needs a Blob store." };
  }

  const stored = await listParts(partPrefix(params.userId, params.uploadId), token);
  const ordered = inUploadOrder(stored, params.expectedParts);
  if (!ordered) {
    return { ok: false, reason: "Upload is incomplete. Please try again." };
  }
  if (ordered.reduce((sum, blob) => sum + blob.size, 0) > params.maxBytes) {
    return { ok: false, reason: "PDF exceeds the configured size limit." };
  }

  const bytes = Buffer.concat(await Promise.all(ordered.map(downloadPart)));
  // Best-effort: a part that survives this is deleted by pruneAbandonedParts.
  await del(ordered.map((blob) => blob.url), { token }).catch((error) => {
    console.error("[upload] deleting assembled parts failed", params.uploadId, error);
  });
  return { ok: true, bytes };
}

/**
 * Delete the parts of uploads that never finished (tab closed mid-upload, a
 * failed part). Returns how many were deleted; null when this deployment has
 * no Blob store.
 */
export async function pruneAbandonedParts(now = new Date()): Promise<number | null> {
  const token = getEnv().BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return null;
  }

  const cutoff = now.getTime() - ABANDONED_AFTER_HOURS * 3_600_000;
  const abandoned = (await listParts(allPartsPrefix(), token)).filter((blob) => blob.uploadedAt.getTime() < cutoff);
  if (abandoned.length > 0) {
    await del(abandoned.map((blob) => blob.url), { token });
  }
  return abandoned.length;
}
