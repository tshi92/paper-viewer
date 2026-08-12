import { prisma } from "@paper-viewer/db";
import { analyzePaperOnDemand } from "@/lib/daily-digest";
import { requireCurrentUser } from "@/lib/auth";

// An LLM analysis of one paper takes tens of seconds — sometimes minutes —
// which the default function time limit cannot accommodate. Production runs
// were hard-killed at the previous 120s ceiling while the model was still
// writing, so the client saw a failure for an analysis that never persisted.
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    }
  });

  if (!workspacePaper) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  // Two teammates clicking Generate at once (or a click racing the digest
  // pipeline) must not produce duplicate analyses; the second caller gets the
  // existing one for free.
  const existing = await prisma.paperAnalysis.findFirst({
    where: { workspaceId: user.workspaceId, paperId },
    select: { id: true }
  });
  if (existing) {
    return Response.json({ ok: true, existing: true });
  }

  try {
    await analyzePaperOnDemand(user.workspaceId, paperId);
  } catch (error) {
    console.error("[analyze] on-demand analysis failed", paperId, error);
    return Response.json({ error: "analysis failed" }, { status: 502 });
  }

  return Response.json({ ok: true });
}
