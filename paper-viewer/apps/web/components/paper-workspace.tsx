"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { CommentPanel } from "./comment-panel";
import { PaperChat } from "./paper-chat";
import { KeynotePanel } from "./keynote-panel";
import { ReadingStateSelect } from "./reading-state-select";
import { DownloadPdfButton } from "./download-pdf-button";
import { AnnotationSidebar } from "./annotation-sidebar";
import type { CreateAnnotationInput } from "./pdf-annotator";
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
  analysis: {
    summary: string;
    motivation: string | null;
    problem: string | null;
    method: string | null;
    keyFindings: string | null;
    whyItMatters: string | null;
    keywords: string[];
  } | null;
  comments: {
    id: string;
    body: string;
    pageNumber: number | null;
    quotedText: string | null;
    createdAt: Date;
    author: { email: string; name: string | null };
  }[];
  readingState: string;
  annotationLabels: LabelView[];
  currentUserId: string;
  isAdmin: boolean;
};

type SidebarTab = "annotations" | "chat" | "keynotes" | "comments";

export function PaperWorkspace({ paper }: { paper: PaperData }) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("annotations");
  const [keynoteVersion, setKeynoteVersion] = useState(0);
  const [annotations, setAnnotations] = useState<AnnotationView[]>([]);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const scrollToAnnotation = useRef<((annotation: AnnotationView) => void) | null>(null);

  const refreshAnnotations = useCallback(async () => {
    const response = await fetch(`/api/papers/${paper.id}/annotations`);
    if (!response.ok) return;
    const data = (await response.json()) as { annotations: AnnotationView[] };
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
      if (!response.ok) return;
      const { annotation } = (await response.json()) as { annotation: AnnotationView };
      setAnnotations((prev) => [...prev, annotation]);
      setSelectedAnnotationId(annotation.id);
      setActiveTab("annotations");
    },
    [paper.id]
  );

  const handleReply = useCallback(
    async (annotationId: string, body: string, parentId?: string) => {
      await fetch(`/api/papers/${paper.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, annotationId, ...(parentId ? { parentId } : {}) })
      });
      await refreshAnnotations();
    },
    [paper.id, refreshAnnotations]
  );

  const handleDeleteAnnotation = useCallback(
    async (annotation: AnnotationView) => {
      const response = await fetch(`/api/papers/${paper.id}/annotations/${annotation.id}`, {
        method: "DELETE"
      });
      if (!response.ok) return;
      setAnnotations((prev) => prev.filter((it) => it.id !== annotation.id));
      setSelectedAnnotationId((current) => (current === annotation.id ? null : current));
    },
    [paper.id]
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
          <div className="mt-3 flex items-center gap-3">
            {paper.arxivId ? (
              <a
                href={`https://arxiv.org/abs/${paper.arxivId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90"
              >
                View on arXiv
              </a>
            ) : null}
            {!paper.hasPdf && paper.arxivId ? (
              <DownloadPdfButton paperId={paper.id} arxivId={paper.arxivId} />
            ) : null}
          </div>
        </div>

        {paper.analysis ? (
          <div className="mb-4 rounded border border-border bg-white p-4">
            <h2 className="text-sm font-semibold uppercase text-muted">AI Analysis</h2>
            <div className="mt-3 space-y-3 text-sm">
              <p>{paper.analysis.summary}</p>
              {paper.analysis.motivation ? <div><span className="font-medium">1. Motivation:</span> {paper.analysis.motivation}</div> : null}
              {paper.analysis.problem ? <div><span className="font-medium">2. Problem:</span> {paper.analysis.problem}</div> : null}
              {paper.analysis.method ? <div><span className="font-medium">3. Method:</span> {paper.analysis.method}</div> : null}
              {paper.analysis.keyFindings ? <div><span className="font-medium">4. Results:</span> {paper.analysis.keyFindings}</div> : null}
              {paper.analysis.whyItMatters ? <div><span className="font-medium">5. Limitations:</span> {paper.analysis.whyItMatters}</div> : null}
              {paper.analysis.keywords.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {paper.analysis.keywords.map((kw) => (
                    <span key={kw} className="rounded bg-surface px-2 py-0.5 text-xs text-muted">{kw}</span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {pdfUrl ? (
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
        ) : (
          <div className="flex items-center justify-center rounded border border-border bg-white p-12 text-sm text-muted">
            {paper.abstract ? (
              <div className="max-w-2xl">
                <h2 className="font-semibold text-ink">Abstract</h2>
                <p className="mt-2 leading-relaxed">{paper.abstract}</p>
              </div>
            ) : (
              <p>No PDF available.</p>
            )}
          </div>
        )}
      </section>
      <aside className="grid content-start gap-3">
        <div className="rounded border border-border bg-white p-4">
          <ReadingStateSelect paperId={paper.id} state={paper.readingState as "new"} />
        </div>

        {/* Tab switcher */}
        <div className="flex rounded border border-border bg-white overflow-hidden">
          {(["annotations", "chat", "keynotes", "comments"] as const).map((tab) => {
            const labels = {
              annotations: "标注",
              chat: "AI Chat",
              keynotes: "Keynotes",
              comments: `Comments (${paper.comments.length})`
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

        {activeTab === "annotations" ? (
          <AnnotationSidebar
            annotations={annotations}
            labels={paper.annotationLabels}
            currentUserId={paper.currentUserId}
            isAdmin={paper.isAdmin}
            selectedId={selectedAnnotationId}
            onJump={(annotation) => {
              setSelectedAnnotationId(annotation.id);
              scrollToAnnotation.current?.(annotation);
            }}
            onReply={handleReply}
            onDelete={handleDeleteAnnotation}
          />
        ) : activeTab === "chat" ? (
          <PaperChat paperId={paper.id} onSaveKeynote={() => { setKeynoteVersion((v) => v + 1); setActiveTab("keynotes"); }} />
        ) : activeTab === "keynotes" ? (
          <KeynotePanel paperId={paper.id} key={`keynotes-${keynoteVersion}`} />
        ) : (
          <CommentPanel
            paperId={paper.id}
            comments={paper.comments}
            pendingQuote={null}
          />
        )}
      </aside>
    </div>
  );
}
