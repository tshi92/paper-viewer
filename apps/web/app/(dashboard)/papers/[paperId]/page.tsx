import { prisma } from "@paper-viewer/db";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { PaperPreview } from "@/components/paper-preview";
import { PaperWorkspace } from "@/components/paper-workspace";
import type { LabelView } from "@/lib/annotation-types";
import { requireCurrentUser } from "@/lib/auth";
import { filterThreadsByParticipant, readViewMode, VIEW_MODE_COOKIE } from "@/lib/view-mode";
import { canAccessPaper, isDigestPaper } from "@/lib/paper-access";
import { hasStoredPdf, isPreprintPdf } from "@/lib/paper-pdf";
import { ensurePdfSnapshot } from "@/lib/pdf-snapshot";

export default async function PaperPage({ params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  // findFirst rather than findUnique on (workspaceId, paperId): an archived row
  // is not library membership. Removing a paper keeps its row so annotations
  // and comments survive, and reading an archived row as "saved" opened the
  // full workspace — remove button included — for a paper the library no
  // longer listed. Falling through to the preview below is what lets it be
  // saved back.
  const workspacePaper = await prisma.workspacePaper.findFirst({
    where: {
      workspaceId: user.workspaceId,
      paperId,
      state: "visible"
    },
    include: {
      paper: {
        include: {
          files: true,
          analyses: {
            where: { workspaceId: user.workspaceId },
            orderBy: { createdAt: "desc" },
            take: 1
          },
          // The edition the paper was accepted at, which the library row already
          // names; newest first, so a paper listed in more than one edition
          // shows the current one.
          conferenceEntries: {
            orderBy: [{ year: "desc" }],
            take: 1,
            select: { venue: true, year: true }
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

    // The preview is read-only — nothing anchors to the bytes — so pinning the
    // snapshot happens after the response instead of before it. Awaiting it
    // meant every first open of a catalog paper waited on a full PDF download
    // from the publisher before anything rendered. The viewer falls back to the
    // arXiv/publisher proxy meanwhile, and the next open serves the pinned copy.
    const previewHasPdf = hasStoredPdf(previewPaper);
    if (!previewHasPdf) {
      after(async () => {
        try {
          await ensurePdfSnapshot(paperId, user.workspaceId);
        } catch {
          /* A failed snapshot does not block reading */
        }
      });
    }

    const previewAnalysis = previewPaper.analyses[0];
    return (
      <PaperPreview
        fromDigest={await isDigestPaper(user.workspaceId, paperId)}
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
          // What an intro could be written from, without downloading anything
          // to find out: the abstract, stored bytes, or arXiv (the only remote
          // source getPaperText will fetch).
          canGenerateIntro:
            Boolean(previewPaper.abstract?.trim()) || previewHasPdf || Boolean(previewPaper.arxivId),
          pdfIsPreprint: isPreprintPdf(previewPaper),
          conference: previewPaper.conferenceEntries[0] ?? null,
          analysis: previewAnalysis
            ? {
                summary: previewAnalysis.summary,
                motivation: previewAnalysis.motivation,
                problem: previewAnalysis.problem,
                method: previewAnalysis.method,
                keyFindings: previewAnalysis.keyFindings,
                whyItMatters: previewAnalysis.whyItMatters,
                keywords: previewAnalysis.keywords,
                generatedAt: previewAnalysis.createdAt.toISOString()
              }
            : null
        }}
      />
    );
  }

  const { paper } = workspacePaper;
  const analysis = paper.analyses[0];

  // Pinning the PDF keeps annotation coordinates from drifting when the
  // upstream version changes, but it downloads the whole file — so it happens
  // after the response rather than in front of it, the same as the preview
  // above. This first view reads the live arXiv/publisher copy (and says so,
  // through pdfFallbackNotice); the next one gets the pinned bytes.
  //
  // It runs after the workspace ownership check either way: otherwise any
  // logged-in user could trigger a download and a storage write for a paper
  // outside their own workspace.
  const hasPdf = hasStoredPdf(paper);
  if (!hasPdf) {
    after(async () => {
      try {
        await ensurePdfSnapshot(paperId, user.workspaceId);
      } catch {
        /* A failed snapshot does not block reading */
      }
    });
  }

  const viewMode = readViewMode((await cookies()).get(VIEW_MODE_COOKIE)?.value);
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
      where: {
        workspaceId: user.workspaceId,
        state: "visible",
        // The personal view narrows the library listing to your own saves, and
        // prev/next walk "the list the user just came from" — so they follow
        // the same lens or j/k would jump to papers the list never showed.
        ...(viewMode === "mine" ? { importedById: user.id } : {})
      },
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
      viewMode={viewMode}
      paper={{
        id: paper.id,
        title: paper.title,
        authors: Array.isArray(paper.authors) ? paper.authors as string[] : [],
        arxivId: paper.arxivId,
        pdfUrl: paper.pdfUrl,
        externalUrl: paper.externalUrl,
        abstract: paper.abstract,
        hasPdf,
        // An abstract, or a PDF whose text can be read: without either there is
        // nothing to write an intro from.
        canGenerateIntro: Boolean(paper.abstract?.trim()) || hasPdf,
        pdfIsPreprint: isPreprintPdf(paper),
        conference: paper.conferenceEntries[0] ?? null,
        analysis: analysis
          ? {
              summary: analysis.summary,
              motivation: analysis.motivation,
              problem: analysis.problem,
              method: analysis.method,
              keyFindings: analysis.keyFindings,
              whyItMatters: analysis.whyItMatters,
              keywords: analysis.keywords,
              generatedAt: analysis.createdAt.toISOString()
            }
          : null,
        comments: (viewMode === "mine" ? filterThreadsByParticipant(comments, user.id) : comments).map((c) => ({
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
