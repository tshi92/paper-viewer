"use client";

import { useState } from "react";
import { PdfViewer } from "./pdf-viewer";
import { CommentPanel } from "./comment-panel";
import { ReadingStateSelect } from "./reading-state-select";
import { DownloadPdfButton } from "./download-pdf-button";

type PaperData = {
  id: string;
  title: string;
  authors: string[];
  arxivId: string | null;
  abstract: string | null;
  hasPdf: boolean;
  analysis: {
    summary: string;
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
};

export function PaperWorkspace({ paper }: { paper: PaperData }) {
  const [pendingQuote, setPendingQuote] = useState<{ text: string; pageNumber: number } | null>(null);

  const pdfUrl = paper.hasPdf
    ? `/api/papers/${paper.id}/file`
    : paper.arxivId
      ? `/api/papers/${paper.id}/arxiv-pdf`
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
              {paper.analysis.problem ? <div><span className="font-medium">Problem:</span> {paper.analysis.problem}</div> : null}
              {paper.analysis.method ? <div><span className="font-medium">Method:</span> {paper.analysis.method}</div> : null}
              {paper.analysis.keyFindings ? <div><span className="font-medium">Key findings:</span> {paper.analysis.keyFindings}</div> : null}
              {paper.analysis.whyItMatters ? <div><span className="font-medium">Why it matters:</span> {paper.analysis.whyItMatters}</div> : null}
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
          <PdfViewer
            paperId={paper.id}
            pdfUrl={pdfUrl}
            onSelectText={(info) => setPendingQuote(info)}
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
      <aside className="grid content-start gap-4">
        <div className="rounded border border-border bg-white p-4">
          <ReadingStateSelect paperId={paper.id} state={paper.readingState as "new"} />
        </div>
        <CommentPanel
          paperId={paper.id}
          comments={paper.comments}
          pendingQuote={pendingQuote}
        />
      </aside>
    </div>
  );
}
