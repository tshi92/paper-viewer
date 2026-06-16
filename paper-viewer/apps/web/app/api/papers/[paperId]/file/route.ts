import { prisma } from "@paper-viewer/db";
import { createS3Client, getPdfObject } from "@paper-viewer/storage/pdf-storage";
import { requireCurrentUser } from "@/lib/auth";
import { getS3Config } from "@/lib/env";

export async function GET(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const s3 = getS3Config();
  const { paperId } = await params;

  if (!s3) {
    return new Response("S3 storage not configured", { status: 501 });
  }

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

  const file = workspacePaper?.paper.files[0];
  if (!file) {
    return new Response("PDF not found", { status: 404 });
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
