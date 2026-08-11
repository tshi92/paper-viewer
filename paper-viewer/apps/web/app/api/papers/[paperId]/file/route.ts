import { prisma } from "@paper-viewer/db";
import { createS3Client, getPdfObject } from "@paper-viewer/storage/pdf-storage";
import { getCurrentUser } from "@/lib/auth";
import { getS3Config } from "@/lib/env";

export async function GET(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Authentication required", { status: 401 });
  }

  const { paperId } = await params;

  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    },
    include: {
      paper: {
        include: {
          files: {
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      }
    }
  });

  if (!workspacePaper) {
    return new Response("PDF not found", { status: 404 });
  }

  const { paper } = workspacePaper;
  const file = paper.files[0];

  // 没有对象存储副本但有 Blob 快照时，服务端代理转发（保持 URL 稳定 + 不暴露 blob 地址）
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
