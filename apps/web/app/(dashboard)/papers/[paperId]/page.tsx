import { prisma } from "@paper-viewer/db";
import { notFound } from "next/navigation";
import { PaperWorkspace } from "@/components/paper-workspace";
import type { LabelView } from "@/lib/annotation-types";
import { requireCurrentUser } from "@/lib/auth";
import { ensurePdfSnapshot } from "@/lib/pdf-snapshot";

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
      },
      labelLinks: { include: { label: true }, orderBy: { label: { createdAt: "asc" } } }
    }
  });

  if (!workspacePaper) {
    notFound();
  }

  const { paper } = workspacePaper;
  const analysis = paper.analyses[0];

  // 快照会下载并写入对象存储，必须排在 workspace 归属校验之后，
  // 否则任何登录用户都能对不属于自己 workspace 的论文触发下载/写入。
  // 首次打开时固化 PDF 快照，之后标注坐标不会因上游改版而漂移。
  let hasPdf = paper.files.length > 0 || Boolean(paper.blobUrl);
  if (!hasPdf) {
    try {
      hasPdf = await ensurePdfSnapshot(paperId, user.workspaceId);
    } catch {
      /* 快照失败不阻塞阅读 */
    }
  }

  const [comments, readingState, workspaceLabels] = await Promise.all([
    prisma.comment.findMany({
      // annotationId: null keeps annotation-thread comments out of the paper-level
      // Discussion list; parentId stays unfiltered so replies to paper-level
      // comments (which inherit annotationId null) remain visible.
      where: { workspaceId: user.workspaceId, paperId, annotationId: null },
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
    }),
    prisma.label.findMany({
      where: { workspaceId: user.workspaceId },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, color: true, scope: true }
    })
  ]);

  function toLabelView(label: { id: string; name: string; color: string; scope: string }): LabelView {
    return { id: label.id, name: label.name, color: label.color, scope: label.scope as LabelView["scope"] };
  }

  const annotationLabels = workspaceLabels.filter((label) => label.scope === "annotation").map(toLabelView);
  const paperLabelOptions = workspaceLabels.filter((label) => label.scope === "paper").map(toLabelView);
  const paperLabels = workspacePaper.labelLinks.map((link) => toLabelView(link.label));

  return (
    <PaperWorkspace
      paper={{
        id: paper.id,
        title: paper.title,
        authors: Array.isArray(paper.authors) ? paper.authors as string[] : [],
        arxivId: paper.arxivId,
        pdfUrl: paper.pdfUrl,
        abstract: paper.abstract,
        hasPdf,
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
          parentId: c.parentId,
          pageNumber: c.pageNumber,
          quotedText: c.quotedText,
          createdAt: c.createdAt,
          author: { id: c.author.id, email: c.author.email, name: c.author.name }
        })),
        readingState: readingState?.state ?? "new",
        annotationLabels,
        paperLabels,
        paperLabelOptions,
        currentUserId: user.id
      }}
    />
  );
}
