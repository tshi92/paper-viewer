import { prisma } from "@paper-viewer/db";
import { notFound } from "next/navigation";
import { PaperPreview } from "@/components/paper-preview";
import { PaperWorkspace } from "@/components/paper-workspace";
import type { LabelView } from "@/lib/annotation-types";
import { requireCurrentUser } from "@/lib/auth";
import { canAccessPaper } from "@/lib/paper-access";
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

  // Not in the library yet: digest papers get a read-only preview with a
  // "save to library" action; anything else in this workspace is a 404.
  if (!workspacePaper) {
    if (!(await canAccessPaper(user.workspaceId, paperId))) {
      notFound();
    }

    const previewPaper = await prisma.paper.findUnique({
      where: { id: paperId },
      include: {
        files: { take: 1 },
        analyses: {
          where: { workspaceId: user.workspaceId },
          orderBy: { createdAt: "desc" },
          take: 1
        },
        conferenceEntries: {
          orderBy: [{ year: "desc" }],
          take: 1,
          select: { venue: true, year: true }
        }
      }
    });
    if (!previewPaper) {
      notFound();
    }

    let previewHasPdf = previewPaper.files.length > 0 || Boolean(previewPaper.blobUrl);
    if (!previewHasPdf) {
      try {
        previewHasPdf = await ensurePdfSnapshot(paperId, user.workspaceId);
      } catch {
        /* A failed snapshot does not block reading */
      }
    }

    const previewAnalysis = previewPaper.analyses[0];
    return (
      <PaperPreview
        paper={{
          id: previewPaper.id,
          title: previewPaper.title,
          authors: Array.isArray(previewPaper.authors) ? (previewPaper.authors as string[]) : [],
          arxivId: previewPaper.arxivId,
          pdfUrl: previewPaper.pdfUrl,
          externalUrl: previewPaper.externalUrl,
          doi: previewPaper.doi,
          abstract: previewPaper.abstract,
          hasPdf: previewHasPdf,
          conference: previewPaper.conferenceEntries[0] ?? null,
          analysis: previewAnalysis
            ? {
                summary: previewAnalysis.summary,
                motivation: previewAnalysis.motivation,
                problem: previewAnalysis.problem,
                method: previewAnalysis.method,
                keyFindings: previewAnalysis.keyFindings,
                whyItMatters: previewAnalysis.whyItMatters,
                keywords: previewAnalysis.keywords
              }
            : null
        }}
      />
    );
  }

  const { paper } = workspacePaper;
  const analysis = paper.analyses[0];

  // Taking the snapshot downloads the file and writes it to object storage, so it
  // must come after the workspace ownership check; otherwise any logged-in user
  // could trigger a download/write for a paper that does not belong to their own
  // workspace.
  // Pinning the PDF snapshot on first open keeps annotation coordinates from
  // drifting when the upstream version changes.
  let hasPdf = paper.files.length > 0 || Boolean(paper.blobUrl);
  if (!hasPdf) {
    try {
      hasPdf = await ensurePdfSnapshot(paperId, user.workspaceId);
    } catch {
      /* A failed snapshot does not block reading */
    }
  }

  const [comments, readingState, workspaceLabels, libraryOrder] = await Promise.all([
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
    }),
    // Same ordering as the library listing, so prev/next and the j/k keys walk
    // the list the user just came from.
    prisma.workspacePaper.findMany({
      where: { workspaceId: user.workspaceId, state: "visible" },
      orderBy: { createdAt: "desc" },
      select: { paperId: true }
    })
  ]);

  const paperIdsInOrder = libraryOrder.map((entry) => entry.paperId);
  const positionInOrder = paperIdsInOrder.indexOf(paperId);
  const prevPaperId = positionInOrder > 0 ? paperIdsInOrder[positionInOrder - 1]! : null;
  const nextPaperId =
    positionInOrder >= 0 && positionInOrder < paperIdsInOrder.length - 1
      ? paperIdsInOrder[positionInOrder + 1]!
      : null;

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
        externalUrl: paper.externalUrl,
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
        prevPaperId,
        nextPaperId,
        annotationLabels,
        paperLabels,
        paperLabelOptions,
        currentUserId: user.id,
        currentUserRole: user.role
      }}
    />
  );
}
