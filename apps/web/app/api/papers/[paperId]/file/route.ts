import { prisma } from "@paper-viewer/db";
import { createS3Client, getPdfObject } from "@paper-viewer/storage/pdf-storage";
import { getCurrentUser } from "@/lib/auth";
import { getS3Config } from "@/lib/env";
import { canAccessPaper } from "@/lib/paper-access";

export async function GET(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Authentication required", { status: 401 });
  }

  const { paperId } = await params;

  // Digest papers are previewable before they are saved, so access goes
  // through the shared check rather than requiring a WorkspacePaper row.
  if (!(await canAccessPaper(user.workspaceId, paperId))) {
    return new Response("PDF not found", { status: 404 });
  }

  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    include: {
      files: {
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  if (!paper) {
    return new Response("PDF not found", { status: 404 });
  }

  const file = paper.files[0];

  // With no object-storage copy but a Blob snapshot available, proxy it from the
  // server (keeps the URL stable and does not expose the blob address)
  if (!file && paper.blobUrl) {
    const upstream = await fetch(paper.blobUrl, { redirect: "follow", cache: "no-store" }).catch(
      () => null
    );
    if (!upstream?.ok || !upstream.body) {
      return new Response("Failed to fetch PDF snapshot", { status: 502 });
    }
    return new Response(upstream.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=86400"
      }
    });
  }

  if (!file) {
    return new Response("PDF not found", { status: 404 });
  }

  const s3 = getS3Config();
  if (!s3) {
    return new Response("S3 storage not configured", { status: 501 });
  }

  const client = createS3Client(s3);
  const object = await getPdfObject({ client, bucket: s3.bucket, key: file.objectKey });
  const bytes = await object.Body?.transformToByteArray();

  if (!bytes) {
    return new Response("PDF content unavailable", { status: 500 });
  }

  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${file.fileName.replaceAll("\"", "")}"`
    }
  });
}
