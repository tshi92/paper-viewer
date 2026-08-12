import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";
import type { LabelView } from "@/lib/annotation-types";

const updatePaperLabelsSchema = z.object({
  labelIds: z.array(z.string()).max(20)
});

function toLabelView(label: { id: string; name: string; color: string; scope: string }): LabelView {
  return { id: label.id, name: label.name, color: label.color, scope: label.scope as LabelView["scope"] };
}

async function resolveCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await requireCurrentUser();
  } catch {
    return null;
  }
}

/**
 * Full replace of a paper's labels, mirroring the annotation PATCH semantics.
 * Any workspace member may retag a paper: paper labels are shared vocabulary,
 * not per-author annotation state, so there is no author check here.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { paperId } = await params;
  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: { workspaceId_paperId: { workspaceId: user.workspaceId, paperId } },
    select: { id: true }
  });
  if (!workspacePaper) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const input = updatePaperLabelsSchema.parse(await request.json());
  const labelIds = [...new Set(input.labelIds)];

  if (labelIds.length > 0) {
    // Rejects ids from another workspace and annotation-scope ids alike: both
    // simply fail to appear in the count of matching paper-scope labels.
    const ownedLabelCount = await prisma.label.count({
      where: { id: { in: labelIds }, workspaceId: user.workspaceId, scope: "paper" }
    });
    if (ownedLabelCount !== labelIds.length) {
      return Response.json({ error: "Invalid label" }, { status: 400 });
    }
  }

  await prisma.$transaction([
    prisma.workspacePaperLabel.deleteMany({ where: { workspaceId: user.workspaceId, paperId } }),
    prisma.workspacePaperLabel.createMany({
      data: labelIds.map((labelId) => ({ workspaceId: user.workspaceId, paperId, labelId }))
    }),
    // WorkspacePaperLabel rows carry no timestamp, so touch the paper itself to
    // keep "last changed" meaningful for the workspace.
    prisma.workspacePaper.update({ where: { id: workspacePaper.id }, data: { updatedAt: new Date() } })
  ]);

  // The link table has no explicit order column; label creation order is the
  // stable ordering used everywhere labels are listed.
  const links = await prisma.workspacePaperLabel.findMany({
    where: { workspaceId: user.workspaceId, paperId },
    include: { label: true },
    orderBy: { label: { createdAt: "asc" } }
  });

  return Response.json({ labels: links.map((link) => toLabelView(link.label)) });
}
