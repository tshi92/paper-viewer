"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BackButton } from "./back-button";
import { CommentPanel } from "./comment-panel";
import { PaperChat } from "./paper-chat";
import { AnalysisPanel, type AnalysisView } from "./analysis-panel";
import { ReadingStateChips } from "./reading-state-chips";
import { DownloadPdfButton } from "./download-pdf-button";
import { AnnotationSidebar } from "./annotation-sidebar";
import { PaperLabelPicker } from "./paper-label-picker";
import type { CreateAnnotationInput } from "./pdf-annotator";
import type { ReadingState } from "@paper-viewer/core/paper-status";
import type { WorkspaceRole } from "@paper-viewer/core/permissions";
import type { AnnotationView, LabelView } from "@/lib/annotation-types";
import type { PdfOutlineEntry } from "@/lib/pdf-outline";

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
  externalUrl: string | null;
  abstract: string | null;
  hasPdf: boolean;
  /** The inline PDF is an arXiv preprint while the version of record is the conference's. */
  pdfIsPreprint: boolean;
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
  currentUserRole: WorkspaceRole;
  /** Neighbours in the library ordering; null at either end of the list. */
  prevPaperId: string | null;
  nextPaperId: string | null;
};

type SidebarTab = "annotations" | "analysis" | "chat" | "comments";

/** Errors are stored as message keys, not rendered strings, so the banner follows the locale. */
type WorkspaceErrorKey = "errorAnnotationCreate" | "errorAnnotationDelete" | "errorReply";

// 简介 leads: opening a paper starts with what it's about; clicking a
// highlight in the PDF still switches to 标注 automatically.
const SIDEBAR_TABS = ["analysis", "chat", "annotations", "comments"] as const;

export function PaperWorkspace({ paper }: { paper: PaperData }) {
  const t = useTranslations("workspace");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SidebarTab>("analysis");
  const [annotations, setAnnotations] = useState<AnnotationView[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<WorkspaceErrorKey | null>(null);
  const scrollToAnnotation = useRef<((annotation: AnnotationView) => void) | null>(null);
  // Embedded PDF bookmarks, reported by the annotator once the document loads;
  // null while loading (or when the paper renders without the annotator).
  const [outline, setOutline] = useState<PdfOutlineEntry[] | null>(null);
  const scrollToPage = useRef<((page: number) => void) | null>(null);

  // Local mutations apply optimistically, so a poll response that started before
  // a mutation would resurrect deleted rows or drop just-created ones. Bumping
  // `mutationSeq` on every mutation invalidates any snapshot already in flight.
  const mutationSeq = useRef(0);
  // Raw body of the last applied poll: an identical response is dropped before
  // setState, so an idle 30s poll no longer re-renders the highlight layer and
  // sidebar with fresh-but-equal array identities.
  const lastAppliedRaw = useRef<string | null>(null);

  /** Every mutation goes through this: invalidates in-flight polls AND the raw-equality skip. */
  const bumpMutation = useCallback(() => {
    mutationSeq.current += 1;
    lastAppliedRaw.current = null;
  }, []);

  const refreshAnnotations = useCallback(async () => {
    const seq = mutationSeq.current;
    const response = await fetch(`/api/papers/${paper.id}/annotations`);
    if (!response.ok) return;
    const raw = await response.text();
    if (seq !== mutationSeq.current) return;
    if (raw === lastAppliedRaw.current) return;
    lastAppliedRaw.current = raw;
    const data = JSON.parse(raw) as { annotations: AnnotationView[] };
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
      bumpMutation();
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
      bumpMutation();
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
      bumpMutation();
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
      bumpMutation();
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

  const registerScrollToPage = useCallback((fn: (page: number) => void) => {
    scrollToPage.current = fn;
  }, []);

  // Triage accelerators: j/k step through the library order, 1–4 switch the
  // sidebar tabs. Anything typed into a field never reaches these.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.key === "j" && paper.nextPaperId) {
        router.push(`/papers/${paper.nextPaperId}`);
      } else if (event.key === "k" && paper.prevPaperId) {
        router.push(`/papers/${paper.prevPaperId}`);
      } else if (event.key >= "1" && event.key <= "4") {
        setActiveTab(SIDEBAR_TABS[Number(event.key) - 1]!);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [paper.nextPaperId, paper.prevPaperId, router]);

  const pdfUrl = paper.hasPdf
    ? `/api/papers/${paper.id}/file`
    : paper.arxivId
      ? `/api/papers/${paper.id}/arxiv-pdf`
      : paper.pdfUrl
        ? `/api/papers/${paper.id}/proxy-pdf`
        : null;

  return (
    <div className="space-y-3">
      {/* Standalone back affordance at the page's top-left, outside the
          title card — it navigates the app, not the paper. */}
      <BackButton fallbackHref="/library" />
      {/* Below lg the sidebar stacks under the PDF instead of squeezing the
          reading column below a usable width. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <section>
        {/* Compact header: the PDF below is the page's protagonist, so the
            card spends as little vertical space as possible. The arXiv link is
            reference material, not a primary action — it reads as a text link. */}
        <div className="mb-3 rounded border border-border bg-white shadow-card px-4 py-3">
          {/* Prev/next stays keyboard-only (j/k): the header links duplicated
              it and competed with the title for attention. */}
          <h1 className="text-lg font-semibold leading-snug">{paper.title}</h1>
          <p className="mt-1 text-xs text-muted">
            {paper.authors.join(", ")}
            {paper.arxivId ? (
              <>
                {" · "}
                <a
                  href={`https://arxiv.org/abs/${paper.arxivId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="whitespace-nowrap text-accent hover:underline"
                >
                  arXiv:{paper.arxivId} ↗
                </a>
                {paper.pdfIsPreprint ? (
                  <span
                    title={tCommon("preprintNote")}
                    className="ml-1.5 rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted"
                  >
                    {tCommon("preprint")}
                  </span>
                ) : null}
              </>
            ) : null}
            {paper.externalUrl ? (
              <>
                {" · "}
                <a
                  href={paper.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="whitespace-nowrap text-accent hover:underline"
                >
                  {tCommon("sourceLink")} ↗
                </a>
              </>
            ) : null}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <PaperLabelPicker
              paperId={paper.id}
              assigned={paper.paperLabels}
              available={paper.paperLabelOptions}
            />
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
            onOutline={setOutline}
            registerScrollToPage={registerScrollToPage}
          />
          </>
        ) : (
          <div className="flex items-center justify-center rounded border border-border bg-white shadow-card p-12 text-sm text-muted">
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
      {/* Sticky full-height column (two-column layouts only): the tab panel
          flexes to whatever the viewport leaves over, so composers at the
          bottom always stay visible no matter how tall the header card is.
          Stacked below lg, the panel takes a fixed 70vh instead. */}
      <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6 lg:h-[calc(100vh-3rem)] lg:self-start">
        <div className="shrink-0 rounded border border-border bg-white shadow-card p-3">
          <ReadingStateChips paperId={paper.id} state={paper.readingState as ReadingState} showLabel />
        </div>

        {actionError ? (
          <p
            role="alert"
            className="rounded border border-danger-border bg-danger-surface px-3 py-2 text-xs text-danger-deep"
          >
            {t(actionError)}
          </p>
        ) : null}

        {/* Tab switcher */}
        <div className="flex shrink-0 rounded border border-border bg-white shadow-card overflow-hidden">
          {SIDEBAR_TABS.map((tab) => {
            const labels = {
              annotations: t("tabAnnotations"),
              analysis: t("tabAnalysis"),
              chat: t("tabChat"),
              comments: t("tabComments")
            };
            return (
              <button
                key={tab}
                className={`flex-1 px-2 py-2 text-sm font-medium transition-colors duration-150 ${activeTab === tab ? "bg-accent text-white" : "text-muted hover:bg-surface"}`}
                onClick={() => setActiveTab(tab)}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* All four tab panels share this slot, so they line up exactly;
            min-w-0 keeps the min-width chain intact so wide chat/code content
            scrolls inside its panel instead of widening the 360px column. */}
        {/* key={activeTab} remounts the slot so each tab entrance replays the
            fade; the panels inside were conditionally mounted anyway. */}
        <div key={activeTab} className="h-[70vh] min-h-0 min-w-0 animate-fade-in lg:h-auto lg:flex-1">
        {activeTab === "annotations" ? (
          <AnnotationSidebar
            annotations={annotations}
            labels={paper.annotationLabels}
            currentUserId={paper.currentUserId}
            currentUserRole={paper.currentUserRole}
            selectedId={selectedAnnotationId}
            onSelect={setSelectedAnnotationId}
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
          <AnalysisPanel
            analysis={paper.analysis}
            paperId={paper.id}
            outline={outline}
            onJumpToPage={(page) => scrollToPage.current?.(page)}
          />
        ) : activeTab === "chat" ? (
          <PaperChat paperId={paper.id} />
        ) : (
          <CommentPanel
            paperId={paper.id}
            comments={paper.comments}
            currentUserId={paper.currentUserId}
            currentUserRole={paper.currentUserRole}
          />
        )}
        </div>
      </aside>
      </div>
    </div>
  );
}
