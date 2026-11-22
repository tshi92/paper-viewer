import { requireCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { isUploadId, UPLOAD_PART_BYTES } from "@/lib/upload-chunks";
import { chunkedUploadEnabled, savePart } from "@/lib/upload-parts";

/**
 * Receives one part of a PDF too large for a single request
 * (lib/upload-chunks.ts). POST /api/papers with `upload` then joins the parts.
 */
export async function POST(request: Request) {
  const user = await requireCurrentUser();
  const env = getEnv();
  if (!chunkedUploadEnabled() || !env.BLOB_READ_WRITE_TOKEN) {
    return new Response("Chunked upload needs a Blob store.", { status: 501 });
  }

  const query = new URL(request.url).searchParams;
  const uploadId = query.get("uploadId") ?? "";
  const index = Number(query.get("index"));
  const maxParts = Math.ceil((env.MAX_PDF_UPLOAD_MB * 1024 * 1024) / UPLOAD_PART_BYTES);
  if (!isUploadId(uploadId) || !Number.isInteger(index) || index < 0) {
    return new Response("Invalid upload part.", { status: 400 });
  }
  if (index >= maxParts) {
    return new Response(`PDF exceeds ${env.MAX_PDF_UPLOAD_MB}MB limit`, { status: 400 });
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > UPLOAD_PART_BYTES) {
    return new Response("Invalid upload part.", { status: 400 });
  }

  await savePart({ userId: user.id, uploadId, index, bytes, token: env.BLOB_READ_WRITE_TOKEN });
  return Response.json({ ok: true });
}
