import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { canModifyComment } from "@paper-viewer/core/permissions";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";

const updateCommentSchema = z.object({
  body: z.string().min(1).max(5000)
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

/**
 * Scopes the lookup to the caller's workspace and the paper in the URL, so a
 * comment from another workspace reads as missing rather than forbidden.
 * `_count.replies` is the direct-reply count, which is what the delete response
 * reports; deeper descendants go with them through the self-referential cascade.
 */
async function findComment(commentId: string, workspaceId: string, paperId: string) {
  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    include: { _count: { select: { replies: true } } }
  });
  return comment && comment.workspaceId === workspaceId && comment.paperId === paperId
    ? comment
    : null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ paperId: string; commentId: string }> }
) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { paperId, commentId } = await params;
  const comment = await findComment(commentId, user.workspaceId, paperId);
  if (!comment) {
    return Response.json({ error: "Comment not found" }, { status: 404 });
  }

  // Authors manage their own comments; admins and owners may moderate anyone's.
  if (!canModifyComment(user.role, comment.authorId === user.id)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = updateCommentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid comment body" }, { status: 400 });
  }

  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: { body: parsed.data.body },
    include: commentInclude
  });

  return Response.json({ comment: updated });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ paperId: string; commentId: string }> }
) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { paperId, commentId } = await params;
  const comment = await findComment(commentId, user.workspaceId, paperId);
  if (!comment) {
    return Response.json({ error: "Comment not found" }, { status: 404 });
  }

  if (!canModifyComment(user.role, comment.authorId === user.id)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Replies go with the parent through the `CommentThread` self-relation cascade.
  await prisma.comment.delete({ where: { id: commentId } });

  return Response.json({ ok: true, deletedReplies: comment._count.replies });
}
