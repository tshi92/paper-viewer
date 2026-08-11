import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";

export async function GET(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    },
    include: { paper: true }
  });

  if (!workspacePaper?.paper.arxivId) {
    return new Response("Paper not found", { status: 404 });
  }

  const pdfRes = await fetch(`https://arxiv.org/pdf/${workspacePaper.paper.arxivId}`, {
    headers: { "User-Agent": "PaperViewer/1.0" }
  });

  if (!pdfRes.ok || !pdfRes.body) {
    return new Response("Failed to fetch PDF from arXiv", { status: 502 });
  }

  return new Response(pdfRes.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "public, max-age=86400"
    }
  });
}
