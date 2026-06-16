"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type SelectionInfo = {
  text: string;
  pageNumber: number;
  x: number;
  y: number;
};

export function PdfViewer({
  paperId,
  pdfUrl,
  onSelectText
}: {
  paperId: string;
  pdfUrl: string;
  onSelectText?: (info: { text: string; pageNumber: number }) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [selection, setSelection] = useState<SelectionInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const doc = await pdfjsLib.getDocument(pdfUrl).promise;
      if (!cancelled) {
        setPdf(doc);
        setTotalPages(doc.numPages);
      }
    }

    load().catch(console.error);
    return () => { cancelled = true; };
  }, [pdfUrl]);

  useEffect(() => {
    if (!pdf || !containerRef.current) return;

    const container = containerRef.current;
    container.innerHTML = "";

    async function renderPages() {
      for (let i = 1; i <= pdf!.numPages; i++) {
        const page = await pdf!.getPage(i);
        const scale = 1.5;
        const viewport = page.getViewport({ scale });

        // Page wrapper
        const pageDiv = document.createElement("div");
        pageDiv.className = "pdf-page";
        pageDiv.style.position = "relative";
        pageDiv.style.width = `${viewport.width}px`;
        pageDiv.style.height = `${viewport.height}px`;
        pageDiv.style.margin = "0 auto 16px auto";
        pageDiv.dataset.pageNumber = String(i);

        // Canvas
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        pageDiv.appendChild(canvas);

        // Text layer
        const textContent = await page.getTextContent();
        const textDiv = document.createElement("div");
        textDiv.style.position = "absolute";
        textDiv.style.top = "0";
        textDiv.style.left = "0";
        textDiv.style.width = `${viewport.width}px`;
        textDiv.style.height = `${viewport.height}px`;
        textDiv.className = "pdf-text-layer";
        pageDiv.appendChild(textDiv);

        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textDiv,
          viewport
        });
        await textLayer.render();

        container.appendChild(pageDiv);
      }
    }

    renderPages().catch(console.error);
  }, [pdf]);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text || text.length < 3) {
      setSelection(null);
      return;
    }

    // Find which page the selection is in
    const anchorNode = sel?.anchorNode;
    let pageEl = anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;
    while (pageEl && !pageEl.classList?.contains("pdf-page")) {
      pageEl = pageEl.parentElement;
    }

    const pageNumber = pageEl ? Number(pageEl.dataset.pageNumber) : 1;

    // Position the button near the selection
    const range = sel?.getRangeAt(0);
    const rect = range?.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();

    if (rect && containerRect) {
      setSelection({
        text,
        pageNumber,
        x: rect.left - containerRect.left + rect.width / 2,
        y: rect.top - containerRect.top - 40
      });
    }
  }, []);

  function handleAddComment() {
    if (selection && onSelectText) {
      onSelectText({ text: selection.text, pageNumber: selection.pageNumber });
    }
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }

  return (
    <div className="relative">
      <div className="mb-2 text-xs text-muted">{totalPages > 0 ? `${totalPages} pages` : "Loading..."}</div>
      <div
        ref={containerRef}
        className="h-[calc(100vh-200px)] overflow-auto rounded border border-border bg-gray-100 p-4"
        onMouseUp={handleMouseUp}
      />
      {selection ? (
        <button
          className="absolute z-10 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-lg"
          style={{ left: selection.x, top: selection.y, transform: "translateX(-50%)" }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleAddComment}
        >
          Comment on p.{selection.pageNumber}
        </button>
      ) : null}
      <style>{`
        .pdf-text-layer {
          opacity: 0.25;
          line-height: 1;
        }
        .pdf-text-layer span {
          position: absolute;
          white-space: pre;
          color: transparent;
          cursor: text;
        }
        .pdf-text-layer span::selection {
          background: rgba(37, 111, 143, 0.3);
          color: transparent;
        }
      `}</style>
    </div>
  );
}
