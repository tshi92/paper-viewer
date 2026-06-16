import { prisma } from "@paper-viewer/db";
import { createPdfObjectKey, createS3Client, putPdfObject } from "@paper-viewer/storage/pdf-storage";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { getS3Config } from "@/lib/env";

const downloadSchema = z.object({
  arxivId: z.string().min(1)
});

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const s3 = getS3Config();
  const { paperId } = await params;

  if (!s3) {
    return Response.json({ error: "S3 storage not configured" }, { status: 501 });
  }

  const body = await request.json();
  const { arxivId } = downloadSchema.parse(body);

  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    }
  });

  if (!workspacePaper) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const existingFile = await prisma.paperFile.findFirst({
    where: { paperId }
  });

  if (existingFile) {
    return Response.json({ ok: true, message: "PDF already downloaded" });
  }

  const pdfUrl = `https://arxiv.org/pdf/${arxivId}`;
  const pdfResponse = await fetch(pdfUrl);

  if (!pdfResponse.ok) {
    return Response.json({ error: `Failed to download PDF: ${pdfResponse.status}` }, { status: 502 });
  }

  const bytes = new Uint8Array(await pdfResponse.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const objectKey = createPdfObjectKey({
    workspaceId: user.workspaceId,
    paperId,
    sha256
  });

  const client = createS3Client(s3);

  await putPdfObject({
    client,
    bucket: s3.bucket,
    key: objectKey,
    body: bytes,
    contentType: "application/pdf"
  });

  await prisma.paperFile.create({
    data: {
      paperId,
      objectKey,
      fileName: `${arxivId}.pdf`,
      contentType: "application/pdf",
      byteLength: bytes.byteLength,
      sha256,
      status: "ready"
    }
  });

  return Response.json({ ok: true });
}
