import { prisma } from "@paper-viewer/db";
import { notFound } from "next/navigation";
import { PaperWorkspace } from "@/components/paper-workspace";
import { requireCurrentUser } from "@/lib/auth";

export default async function PaperPage({ params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    },
    include: {
      paper: {
        include: {
          files: true,
          analyses: {
            where: { workspaceId: user.workspaceId },
            orderBy: { createdAt: "desc" },
            take: 1
          }
        }
      }
    }
  });

  if (!workspacePaper) {
    notFound();
  }

  const { paper } = workspacePaper;
  const analysis = paper.analyses[0];

  const [comments, readingState] = await Promise.all([
    prisma.comment.findMany({
      where: { workspaceId: user.workspaceId, paperId },
      include: { author: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.readingStateRecord.findUnique({
      where: {
        workspaceId_paperId_userId: {
          workspaceId: user.workspaceId,
          paperId,
          userId: user.id
        }
      }
    })
  ]);

  return (
    <PaperWorkspace
      paper={{
        id: paper.id,
        title: paper.title,
        authors: Array.isArray(paper.authors) ? paper.authors as string[] : [],
        arxivId: paper.arxivId,
        pdfUrl: paper.pdfUrl,
        abstract: paper.abstract,
        hasPdf: paper.files.length > 0,
        analysis: analysis
          ? {
              summary: analysis.summary,
              motivation: analysis.motivation,
              problem: analysis.problem,
              method: analysis.method,
              keyFindings: analysis.keyFindings,
              whyItMatters: analysis.whyItMatters,
              keywords: analysis.keywords
            }
          : null,
        comments: comments.map((c) => ({
          id: c.id,
          body: c.body,
          pageNumber: c.pageNumber,
          quotedText: c.quotedText,
          createdAt: c.createdAt,
          author: { email: c.author.email, name: c.author.name }
        })),
        readingState: readingState?.state ?? "new"
      }}
    />
  );
}
