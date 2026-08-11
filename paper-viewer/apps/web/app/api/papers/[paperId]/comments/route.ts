import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";

const commentSchema = z.object({
  body: z.string().min(1).max(5000),
  pageNumber: z.coerce.number().int().positive().optional(),
  quotedText: z.string().max(2000).optional(),
  parentId: z.string().optional(),
  annotationId: z.string().optional()
});

const commentInclude = {
  author: { select: { id: true, email: true, name: true } }
};

async function resolveCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await requireCurrentUser();
  } catch {
    return null;
  }
}

async function workspacePaperExists(workspaceId: string, paperId: string): Promise<boolean> {
  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: { workspaceId_paperId: { workspaceId, paperId } }
  });
  return workspacePaper !== null;
}

async function readRawInput(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await request.json()) as Record<string, unknown>;
  }
  return Object.fromEntries((await request.formData()).entries());
}

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { paperId } = await params;
  if (!(await workspacePaperExists(user.workspaceId, paperId))) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const raw = await readRawInput(request);
  const input = commentSchema.parse({
    ...raw,
    pageNumber: raw.pageNumber || undefined,
    quotedText: raw.quotedText || undefined,
    parentId: raw.parentId || undefined,
    annotationId: raw.annotationId || undefined
  });

  if (input.parentId) {
    const parent = await prisma.comment.findUnique({ where: { id: input.parentId } });
    if (!parent || parent.workspaceId !== user.workspaceId || parent.paperId !== paperId) {
      return Response.json({ error: "Invalid parent comment" }, { status: 400 });
    }
  }

  if (input.annotationId) {
    const annotation = await prisma.annotation.findUnique({ where: { id: input.annotationId } });
    if (!annotation || annotation.workspaceId !== user.workspaceId || annotation.paperId !== paperId) {
      return Response.json({ error: "Invalid annotation" }, { status: 400 });
    }
  }

  const comment = await prisma.comment.create({
    data: {
      workspaceId: user.workspaceId,
      paperId,
      authorId: user.id,
      body: input.body,
      pageNumber: input.pageNumber ?? null,
      quotedText: input.quotedText ?? null,
      parentId: input.parentId ?? null,
      annotationId: input.annotationId ?? null
    },
    include: commentInclude
  });

  return Response.json({ comment }, { status: 201 });
}
