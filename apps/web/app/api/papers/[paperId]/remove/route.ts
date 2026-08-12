import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";

export async function POST(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  // paperId here is actually workspacePaperId
  const wp = await prisma.workspacePaper.findUnique({
    where: { id: paperId }
  });

  if (!wp || wp.workspaceId !== user.workspaceId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Archive instead of hard delete
  await prisma.workspacePaper.update({
    where: { id: paperId },
    data: { state: "archived" }
  });

  return Response.json({ ok: true });
}
