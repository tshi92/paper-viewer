import { prisma } from "@paper-viewer/db";
import { createS3Client, getPdfObject } from "@paper-viewer/storage/pdf-storage";
import { requireCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";

export async function GET(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const env = getEnv();
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

  const file = workspacePaper?.paper.files[0];
  if (!file) {
    return new Response("PDF not found", { status: 404 });
  }

  const client = createS3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
  });

  const object = await getPdfObject({ client, bucket: env.S3_BUCKET, key: file.objectKey });
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
