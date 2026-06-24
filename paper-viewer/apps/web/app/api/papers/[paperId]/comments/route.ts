import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  pageNumber: z.coerce.number().int().positive().optional(),
  quotedText: z.string().max(2000).optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

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

  const formData = await request.formData();
  const input = commentSchema.parse({
    body: formData.get("body"),
    pageNumber: formData.get("pageNumber") || undefined,
    quotedText: formData.get("quotedText") || undefined
  });

  await prisma.comment.create({
    data: {
      workspaceId: user.workspaceId,
      paperId,
      authorId: user.id,
      body: input.body,
      pageNumber: input.pageNumber ?? null,
      quotedText: input.quotedText ?? null
    }
  });

  return Response.json({ ok: true });
}
