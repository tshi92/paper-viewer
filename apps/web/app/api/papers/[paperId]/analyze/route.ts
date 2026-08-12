import { prisma } from "@paper-viewer/db";
import { analyzePaperOnDemand } from "@/lib/daily-digest";
import { requireCurrentUser } from "@/lib/auth";

// LLM 分析一篇要几十秒，默认的函数时限扛不住。
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
