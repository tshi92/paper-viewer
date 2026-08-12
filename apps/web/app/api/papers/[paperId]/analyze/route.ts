import { prisma } from "@paper-viewer/db";
import { analyzePaperOnDemand } from "@/lib/daily-digest";
import { requireCurrentUser } from "@/lib/auth";

// An LLM analysis of one paper takes tens of seconds, which the default function
// time limit cannot accommodate.
export const maxDuration = 120;

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

  try {
    await analyzePaperOnDemand(user.workspaceId, paperId);
  } catch (error) {
    console.error("[analyze] on-demand analysis failed", paperId, error);
    return Response.json({ error: "analysis failed" }, { status: 502 });
  }

  return Response.json({ ok: true });
}
