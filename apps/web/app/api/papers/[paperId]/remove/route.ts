import { prisma } from "@paper-viewer/db";
import { canRemovePaper } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";

/**
 * Archives a paper out of the workspace library. The row is kept (state:
 * "archived") so annotations, comments and reading states survive, and saving
 * the same paper again revives it instead of creating a duplicate.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  // Removing takes the paper out of *everyone's* library, so it is admin-only.
  if (!canRemovePaper(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // Scoping the lookup by workspace is both the ownership check and the
  // "already archived?" check — an archived row is not visible to remove twice.
  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: { workspaceId_paperId: { workspaceId: user.workspaceId, paperId } },
    select: { id: true, state: true }
  });

  if (!workspacePaper || workspacePaper.state !== "visible") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.workspacePaper.update({
    where: { id: workspacePaper.id },
    data: { state: "archived" }
  });

  return Response.json({ ok: true });
}
