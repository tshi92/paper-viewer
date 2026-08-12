import { prisma } from "@paper-viewer/db";

/**
 * Whether a workspace may see a paper at all: either it was saved to the
 * library (WorkspacePaper exists) or one of the workspace's digests surfaced
 * it. Digest papers are readable in preview before anyone saves them, so
 * PDF-serving routes and the paper page share this check. (A conference paper
 * source will add another branch here.)
 */
export async function canAccessPaper(workspaceId: string, paperId: string): Promise<boolean> {
  const saved = await prisma.workspacePaper.findUnique({
    where: { workspaceId_paperId: { workspaceId, paperId } },
    select: { workspaceId: true }
  });
  if (saved) {
    return true;
  }
  const digest = await prisma.dailyDigest.findFirst({
    where: { workspaceId, paperIds: { has: paperId } },
    select: { id: true }
  });
  return digest !== null;
}
