import { prisma } from "@paper-viewer/db";
import { after } from "next/server";
import { analysisTags, analyzePaperOnDemand, isUniqueViolation } from "@/lib/daily-digest";
import { canAccessPaper } from "@/lib/paper-access";
import { findLibraryDuplicate } from "@/lib/library-dedup";
import { requireCurrentUser } from "@/lib/auth";

// The post-save analysis runs in after(); give it the same budget as /analyze.
export const maxDuration = 120;

/**
 * "Save to library": the only way a digest or conference paper becomes a
 * WorkspacePaper. Idempotent — saving twice, or racing another member, still
 * ends with exactly one library row. If the same article already sits in the
 * library under another Paper row (matched by DOI, arXiv id, or normalized
 * title), no second row is created; the response points at the existing one.
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

  const paper = await prisma.paper.findUnique({
    where: { id: paperId },
    select: { title: true, doi: true, arxivId: true }
  });
  if (!paper) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  // Duplicate-article check: the same paper can exist as two Paper rows when
  // sources disagree on identifiers (digest row with an arXiv id, conference
  // row without one). Never let both end up in the library.
  const duplicateId = await findLibraryDuplicate(user.workspaceId, paper);
  if (duplicateId) {
    return Response.json({ saved: false, duplicate: true, existingPaperId: duplicateId });
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

  // Conference papers arrive with raw metadata only; generate the AI intro
  // once they actually enter the library. Runs after the response so the save
  // button is not held hostage by a long LLM call; digest papers already have
  // an analysis and skip this.
  const analyzed = await prisma.paperAnalysis.findFirst({
    where: { paperId, workspaceId: user.workspaceId },
    select: { id: true }
  });
  if (!analyzed) {
    after(async () => {
      try {
        await analyzePaperOnDemand(user.workspaceId, paperId);
      } catch (error) {
        console.error("[save] post-save analysis failed", paperId, error);
      }
    });
  }

  return Response.json({ saved: true });
}
