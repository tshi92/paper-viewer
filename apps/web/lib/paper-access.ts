import { prisma } from "@paper-viewer/db";

/**
 * Whether a workspace may see a paper at all: it was saved to the library
 * (WorkspacePaper exists), one of the workspace's digests surfaced it, or it
 * belongs to the shared conference catalog. Unsaved papers are readable in
 * preview only, so PDF-serving routes and the paper page share this check.
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
  if (digest) {
    return true;
  }
  const conference = await prisma.conferenceEntry.findFirst({
    where: { paperId },
    select: { id: true }
  });
  return conference !== null;
}

/**
 * Whether this workspace met the paper through a daily digest. The digest run
 * writes an intro for every paper it picks, so a digest paper with no intro
 * means the run failed on it — which is a different thing to say than "save it
 * to the library and one will be generated".
 */
export async function isDigestPaper(workspaceId: string, paperId: string): Promise<boolean> {
  const digest = await prisma.dailyDigest.findFirst({
    where: { workspaceId, paperIds: { has: paperId } },
    select: { id: true }
  });
  return digest !== null;
}
