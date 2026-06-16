import { validatePdfUpload } from "@paper-viewer/core/upload-validation";
import { prisma } from "@paper-viewer/db";
import { createPdfObjectKey, createS3Client, putPdfObject } from "@paper-viewer/storage/pdf-storage";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";

const paperInputSchema = z.object({
  title: z.string().min(1),
  abstract: z.string().optional(),
  authors: z.string().min(1)
});

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  const env = getEnv();
  const formData = await request.formData();
  const file = formData.get("pdf");

  if (!(file instanceof File)) {
    return new Response("PDF file is required", { status: 400 });
  }

  const input = paperInputSchema.parse({
    title: formData.get("title"),
    abstract: formData.get("abstract")?.toString() || undefined,
    authors: formData.get("authors")
  });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const validation = validatePdfUpload({
    fileName: file.name,
    contentType: file.type,
    byteLength: bytes.byteLength,
    maxBytes: env.MAX_PDF_UPLOAD_MB * 1024 * 1024
  });

  if (!validation.ok) {
    return new Response(validation.reason, { status: 400 });
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const authors = input.authors.split(",").map((author) => author.trim()).filter(Boolean);

  const paper = await prisma.paper.create({
    data: {
      title: input.title,
      abstract: input.abstract ?? null,
      authors,
      source: "manual",
      workspacePapers: {
        create: {
          workspaceId: user.workspaceId,
          importedById: user.id
        }
      }
    }
  });

  const objectKey = createPdfObjectKey({
    workspaceId: user.workspaceId,
    paperId: paper.id,
    sha256
  });

  const client = createS3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    bucket: env.S3_BUCKET,
    forcePathStyle: env.S3_FORCE_PATH_STYLE === "true"
  });

  await putPdfObject({
    client,
    bucket: env.S3_BUCKET,
    key: objectKey,
    body: bytes,
    contentType: "application/pdf"
  });

  await prisma.paperFile.create({
    data: {
      paperId: paper.id,
      objectKey,
      fileName: file.name,
      contentType: "application/pdf",
      byteLength: bytes.byteLength,
      sha256,
      status: "ready"
    }
  });

  redirect(`/papers/${paper.id}`);
}
