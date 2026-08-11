import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { canDeleteAnnotation } from "@paper-viewer/core/permissions";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";

const updateAnnotationSchema = z.object({
  labelIds: z.array(z.string()).max(10)
});

async function resolveCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await requireCurrentUser();
  } catch {
    return null;
  }
}

async function findAnnotation(annotationId: string, workspaceId: string, paperId: string) {
  const annotation = await prisma.annotation.findUnique({
    where: { id: annotationId },
    include: { _count: { select: { comments: true } } }
  });
  return annotation && annotation.workspaceId === workspaceId && annotation.paperId === paperId ? annotation : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ paperId: string; annotationId: string }> }
) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { paperId, annotationId } = await params;
  const annotation = await findAnnotation(annotationId, user.workspaceId, paperId);
  if (!annotation) {
    return Response.json({ error: "Annotation not found" }, { status: 404 });
  }

  if (annotation.authorId !== user.id) {
    return Response.json({ error: "Only the author can edit labels" }, { status: 403 });
  }

  const input = updateAnnotationSchema.parse(await request.json());
  const labelIds = [...new Set(input.labelIds)];

  if (labelIds.length > 0) {
    const ownedLabelCount = await prisma.label.count({
      where: { id: { in: labelIds }, workspaceId: user.workspaceId, scope: "annotation" }
    });
    if (ownedLabelCount !== labelIds.length) {
      return Response.json({ error: "Invalid label" }, { status: 400 });
    }
  }

  await prisma.$transaction([
    prisma.annotationLabel.deleteMany({ where: { annotationId } }),
    prisma.annotationLabel.createMany({
      data: labelIds.map((labelId, order) => ({ annotationId, labelId, order }))
    })
  ]);

  return Response.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ paperId: string; annotationId: string }> }
) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { paperId, annotationId } = await params;
  const annotation = await findAnnotation(annotationId, user.workspaceId, paperId);
  if (!annotation) {
    return Response.json({ error: "Annotation not found" }, { status: 404 });
  }

  if (!canDeleteAnnotation(user.role, annotation.authorId === user.id)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.annotation.delete({ where: { id: annotationId } });

  return Response.json({ ok: true, deletedComments: annotation._count.comments });
}
