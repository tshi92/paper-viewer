import { prisma } from "@paper-viewer/db";
import { notFound } from "next/navigation";
import { CommentPanel } from "@/components/comment-panel";
import { PdfViewer } from "@/components/pdf-viewer";
import { ReadingStateSelect } from "@/components/reading-state-select";
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
          files: true
        }
      }
    }
  });

  if (!workspacePaper) {
    notFound();
  }

  const [comments, readingState] = await Promise.all([
    prisma.comment.findMany({
      where: {
        workspaceId: user.workspaceId,
        paperId
      },
      include: {
        author: true
      },
      orderBy: {
        createdAt: "asc"
      }
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
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6">
      <section>
        <div className="mb-4 rounded border border-border bg-white p-4">
          <h1 className="text-xl font-semibold">{workspacePaper.paper.title}</h1>
          <p className="mt-2 text-sm text-muted">
            {Array.isArray(workspacePaper.paper.authors) ? workspacePaper.paper.authors.join(", ") : ""}
          </p>
        </div>
        <PdfViewer paperId={paperId} />
      </section>
      <aside className="grid content-start gap-4">
        <div className="rounded border border-border bg-white p-4">
          <ReadingStateSelect paperId={paperId} state={readingState?.state ?? "new"} />
        </div>
        <CommentPanel paperId={paperId} comments={comments} />
      </aside>
    </div>
  );
}
