"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { CommentPanel } from "./comment-panel";
import { PaperChat } from "./paper-chat";
import { AnalysisPanel, type AnalysisView } from "./analysis-panel";
import { ReadingStateSelect } from "./reading-state-select";
import { DownloadPdfButton } from "./download-pdf-button";
import { AnnotationSidebar } from "./annotation-sidebar";
import { PaperLabelPicker } from "./paper-label-picker";
import type { CreateAnnotationInput } from "./pdf-annotator";
import type { ReadingState } from "@paper-viewer/core/paper-status";
import type { AnnotationView, LabelView } from "@/lib/annotation-types";

// react-pdf-highlighter touches the DOM at import time, so the annotator is
// client-only.
const PdfAnnotator = dynamic(() => import("./pdf-annotator").then((m) => m.PdfAnnotator), {
  ssr: false
});

type PaperData = {
  id: string;
  title: string;
  authors: string[];
  arxivId: string | null;
  pdfUrl: string | null;
  abstract: string | null;
  hasPdf: boolean;
  analysis: AnalysisView | null;
  comments: {
    id: string;
    body: string;
    parentId: string | null;
    pageNumber: number | null;
    quotedText: string | null;
    createdAt: Date;
    author: { id: string; email: string; name: string | null };
  }[];
  readingState: string;
  annotationLabels: LabelView[];
  /** Paper-scope labels currently assigned to this paper. */
  paperLabels: LabelView[];
  /** Every paper-scope label in the workspace, i.e. what the picker can offer. */
  paperLabelOptions: LabelView[];
  currentUserId: string;
};

type SidebarTab = "annotations" | "analysis" | "chat" | "comments";

/** Errors are stored as message keys, not rendered strings, so the banner follows the locale. */
type WorkspaceErrorKey = "errorAnnotationCreate" | "errorAnnotationDelete" | "errorReply";

export function PaperWorkspace({ paper }: { paper: PaperData }) {
  const t = useTranslations("workspace");
  const [activeTab, setActiveTab] = useState<SidebarTab>("annotations");
  const [annotations, setAnnotations] = useState<AnnotationView[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<WorkspaceErrorKey | null>(null);
  const scrollToAnnotation = useRef<((annotation: AnnotationView) => void) | null>(null);

  // Local mutations apply optimistically, so a poll response that started before
  // a mutation would resurrect deleted rows or drop just-created ones. Bumping
  // `mutationSeq` on every mutation invalidates any snapshot already in flight.
  const mutationSeq = useRef(0);

  const refreshAnnotations = useCallback(async () => {
    const seq = mutationSeq.current;
    const response = await fetch(`/api/papers/${paper.id}/annotations`);
    if (!response.ok) return;
    const data = (await response.json()) as { annotations: AnnotationView[] };
    if (seq !== mutationSeq.current) return;
    setAnnotations(data.annotations);
  }, [paper.id]);

  useEffect(() => {
    void refreshAnnotations();
    // 30s polling keeps collaborators' annotations flowing in without sockets.
    const timer = setInterval(() => void refreshAnnotations(), 30_000);
    return () => clearInterval(timer);
  }, [refreshAnnotations]);

  const handleCreateAnnotation = useCallback(
    async (input: CreateAnnotationInput) => {
      const response = await fetch(`/api/papers/${paper.id}/annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input)
      });
      if (!response.ok) {
        setActionError("errorAnnotationCreate");
        // Throw so the selection tip stays open and the typed comment survives.
        throw new Error("annotation create failed");
      }
      mutationSeq.current += 1;
      const { annotation } = (await response.json()) as { annotation: AnnotationView };
      setActionError(null);
      setAnnotations((prev) => [...prev, annotation]);
      setSelectedAnnotationId(annotation.id);
      setActiveTab("annotations");
      void refreshAnnotations();
    },
    [paper.id, refreshAnnotations]
  );

  const handleReply = useCallback(
    async (annotationId: string, body: string) => {
      const response = await fetch(`/api/papers/${paper.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, annotationId })
      });
      if (!response.ok) {
        setActionError("errorReply");
        throw new Error("Failed to post reply");
      }
      mutationSeq.current += 1;
      setActionError(null);
      await refreshAnnotations();
    },
    [paper.id, refreshAnnotations]
  );

  /**
   * Edits and deletes of thread comments are author-only server-side; the sidebar
   * only offers them on the caller's own comments, and `CommentBody` reports a
   * rejection inline, so failures do not need the workspace-wide banner.
   */
  const mutateComment = useCallback(
    async (commentId: string, init: RequestInit) => {
      const response = await fetch(`/api/papers/${paper.id}/comments/${commentId}`, init);
      if (!response.ok) throw new Error("comment mutation failed");
      mutationSeq.current += 1;
      await refreshAnnotations();
    },
    [paper.id, refreshAnnotations]
  );

  const handleEditComment = useCallback(
    (commentId: string, body: string) =>
      mutateComment(commentId, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body })
      }),
    [mutateComment]
  );

  const handleDeleteComment = useCallback(
    (commentId: string) => mutateComment(commentId, { method: "DELETE" }),
    [mutateComment]
  );

  const handleDeleteAnnotation = useCallback(
    async (annotation: AnnotationView) => {
      const response = await fetch(`/api/papers/${paper.id}/annotations/${annotation.id}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        setActionError("errorAnnotationDelete");
        return;
      }
      mutationSeq.current += 1;
      setActionError(null);
      setAnnotations((prev) => prev.filter((it) => it.id !== annotation.id));
      setSelectedAnnotationId((current) => (current === annotation.id ? null : current));
      void refreshAnnotations();
    },
    [paper.id, refreshAnnotations]
  );

  const registerScrollTo = useCallback((fn: (annotation: AnnotationView) => void) => {
    scrollToAnnotation.current = fn;
  }, []);

  const pdfUrl = paper.hasPdf
    ? `/api/papers/${paper.id}/file`
    : paper.arxivId
      ? `/api/papers/${paper.id}/arxiv-pdf`
      : paper.pdfUrl
        ? `/api/papers/${paper.id}/proxy-pdf`
        : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_360px] gap-6">
      <section>
        <div className="mb-4 rounded border border-border bg-white p-4">
          <h1 className="text-xl font-semibold">{paper.title}</h1>
          <p className="mt-2 text-sm text-muted">{paper.authors.join(", ")}</p>
          <PaperLabelPicker
            paperId={paper.id}
            assigned={paper.paperLabels}
            available={paper.paperLabelOptions}
          />
          <div className="mt-3 flex items-center gap-3">
            {paper.arxivId ? (
              <a
                href={`https://arxiv.org/abs/${paper.arxivId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
              >
                {t("viewOnArxiv")}
              </a>
            ) : null}
            {!paper.hasPdf && paper.arxivId ? (
              <DownloadPdfButton paperId={paper.id} arxivId={paper.arxivId} />
            ) : null}
          </div>
        </div>

        {pdfUrl ? (
          <>
            {!paper.hasPdf ? (
              <p className="mb-2 rounded border border-border bg-surface px-3 py-2 text-xs text-muted">
                {t("pdfFallbackNotice")}
              </p>
            ) : null}
            <PdfAnnotator
            pdfUrl={pdfUrl}
            annotations={annotations}
            annotationLabels={paper.annotationLabels}
            selectedId={selectedAnnotationId}
            onSelect={(id) => {
              setSelectedAnnotationId(id);
              setActiveTab("annotations");
            }}
            onCreate={handleCreateAnnotation}
            registerScrollTo={registerScrollTo}
          />
          </>
        ) : (
          <div className="flex items-center justify-center rounded border border-border bg-white p-12 text-sm text-muted">
            {paper.abstract ? (
              <div className="max-w-2xl">
                <h2 className="font-semibold text-ink">{t("abstractHeading")}</h2>
                <p className="mt-2 leading-relaxed">{paper.abstract}</p>
              </div>
            ) : (
              <p>{t("noPdf")}</p>
            )}
          </div>
        )}
      </section>
      <aside className="grid min-w-0 content-start gap-3">
        <div className="rounded border border-border bg-white p-4">
          <ReadingStateSelect paperId={paper.id} state={paper.readingState as ReadingState} />
        </div>

        {actionError ? (
          <p
            role="alert"
            className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-600"
          >
            {t(actionError)}
          </p>
        ) : null}

        {/* Tab switcher */}
        <div className="flex rounded border border-border bg-white overflow-hidden">
          {(["annotations", "analysis", "chat", "comments"] as const).map((tab) => {
            const labels = {
              annotations: t("tabAnnotations"),
              analysis: t("tabAnalysis"),
              chat: t("tabChat"),
              comments: t("tabComments", { count: paper.comments.length })
            };
            return (
              <button
                key={tab}
                className={`flex-1 px-2 py-2 text-sm font-medium ${activeTab === tab ? "bg-accent text-white" : "text-muted hover:bg-surface"}`}
                onClick={() => setActiveTab(tab)}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* Fixed shared height so all four tab panels line up exactly. */}
        <div className="h-[calc(100vh-240px)] min-h-0">
        {activeTab === "annotations" ? (
          <AnnotationSidebar
            annotations={annotations}
            labels={paper.annotationLabels}
            currentUserId={paper.currentUserId}
            selectedId={selectedAnnotationId}
            // Selecting alone would not move the viewer when the row is already
            // selected, so the jump is asked for directly; the annotator makes
            // sure a fresh selection is not then scrolled to twice.
            onJump={(annotation) => {
              setSelectedAnnotationId(annotation.id);
              scrollToAnnotation.current?.(annotation);
            }}
            onReply={handleReply}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            onDelete={handleDeleteAnnotation}
          />
        ) : activeTab === "analysis" ? (
          <AnalysisPanel analysis={paper.analysis} />
        ) : activeTab === "chat" ? (
          <PaperChat paperId={paper.id} />
        ) : (
          <CommentPanel
            paperId={paper.id}
            comments={paper.comments}
            currentUserId={paper.currentUserId}
          />
        )}
        </div>
      </aside>
    </div>
  );
}
