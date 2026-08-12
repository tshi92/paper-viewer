import { prisma } from "@paper-viewer/db";
import { analysisTags, isUniqueViolation } from "@/lib/daily-digest";
import { canAccessPaper } from "@/lib/paper-access";
import { requireCurrentUser } from "@/lib/auth";

/**
 * "Save to library": the only way a digest (or, later, conference) paper
 * becomes a WorkspacePaper. Idempotent — saving twice, or racing another
 * member, still ends with exactly one library row.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { paperId } = await params;

  const existing = await prisma.workspacePaper.findUnique({
    where: { workspaceId_paperId: { workspaceId: user.workspaceId, paperId } },
    select: { workspaceId: true }
  });
  if (existing) {
    return Response.json({ saved: true });
  }

  if (!(await canAccessPaper(user.workspaceId, paperId))) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  try {
    await prisma.workspacePaper.create({
      data: {
        workspaceId: user.workspaceId,
        paperId,
        importedById: user.id,
        // The digest's analysis keywords become the starting library tags.
        tags: await analysisTags(user.workspaceId, paperId)
      }
    });
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  return Response.json({ saved: true });
}
