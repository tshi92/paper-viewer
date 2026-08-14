import { prisma } from "@paper-viewer/db";
import { analyzePaperOnDemand } from "@/lib/daily-digest";
import { requireCurrentUser } from "@/lib/auth";

// An LLM analysis of one paper takes tens of seconds — sometimes minutes —
// which the default function time limit cannot accommodate. Production runs
// were hard-killed at the previous 120s ceiling while the model was still
// writing, so the client saw a failure for an analysis that never persisted.
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  // `regenerate: true` (the ⋮ menu on the Intro card) runs the analysis again
  // and replaces the existing one; the plain call keeps its first-writer-wins
  // behaviour. The body is optional — the original generate button sends none.
  const body = (await request.json().catch(() => ({}))) as { regenerate?: boolean };
  const regenerate = body.regenerate === true;

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
  // existing one for free. A regeneration skips this — an existing analysis is
  // its precondition, not a reason to stop.
  if (!regenerate) {
    const existing = await prisma.paperAnalysis.findFirst({
      where: { workspaceId: user.workspaceId, paperId },
      select: { id: true }
    });
    if (existing) {
      return Response.json({ ok: true, existing: true });
    }
  }

  let generated: boolean;
  try {
    generated = await analyzePaperOnDemand(user.workspaceId, paperId, { replace: regenerate });
  } catch (error) {
    console.error("[analyze] on-demand analysis failed", paperId, error);
    return Response.json({ error: "analysis failed" }, { status: 502 });
  }

  // `generated: false` is not an error: the paper carries no abstract and no
  // readable PDF, so there was nothing to write an intro from. The client stops
  // waiting and explains that, rather than polling for an analysis that will
  // never appear.
  return Response.json({ ok: true, generated });
}
