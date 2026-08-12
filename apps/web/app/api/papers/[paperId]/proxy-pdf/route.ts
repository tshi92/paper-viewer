import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";
import { canAccessPaper } from "@/lib/paper-access";

export async function GET(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  if (!(await canAccessPaper(user.workspaceId, paperId))) {
    return new Response("No PDF URL for this paper", { status: 404 });
  }

  const paper = await prisma.paper.findUnique({ where: { id: paperId } });

  if (!paper?.pdfUrl) {
    return new Response("No PDF URL for this paper", { status: 404 });
  }

  const pdfRes = await fetch(paper.pdfUrl, {
    headers: { "User-Agent": "PaperViewer/1.0" },
    redirect: "follow"
  });

  if (!pdfRes.ok || !pdfRes.body) {
    return new Response("Failed to fetch PDF from source", { status: 502 });
  }

  return new Response(pdfRes.body, {
    headers: {
      "Content-Type": "application/pdf",
      "Cache-Control": "public, max-age=86400"
    }
  });
}
