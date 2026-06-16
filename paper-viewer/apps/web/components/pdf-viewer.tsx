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

const SCALES = [0.75, 1, 1.25, 1.5, 2, 2.5];

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
  const [scale, setScale] = useState(1.25);
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
    const dpr = window.devicePixelRatio || 1;

    async function renderPages() {
      for (let i = 1; i <= pdf!.numPages; i++) {
        const page = await pdf!.getPage(i);
        const viewport = page.getViewport({ scale });

        // Page wrapper - sized to CSS pixels
        const pageDiv = document.createElement("div");
        pageDiv.className = "pdf-page";
        pageDiv.style.position = "relative";
        pageDiv.style.width = `${viewport.width}px`;
        pageDiv.style.height = `${viewport.height}px`;
        pageDiv.style.margin = "0 auto 16px auto";
        pageDiv.dataset.pageNumber = String(i);

        // Canvas - render at device pixel ratio for sharpness
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d")!;
        ctx.scale(dpr, dpr);
        await page.render({ canvasContext: ctx, viewport }).promise;
        pageDiv.appendChild(canvas);

        // Text layer - must match viewport exactly
        const textContent = await page.getTextContent();
        const textDiv = document.createElement("div");
        textDiv.className = "pdf-text-layer";
        textDiv.style.position = "absolute";
        textDiv.style.left = "0";
        textDiv.style.top = "0";
        textDiv.style.right = "0";
        textDiv.style.bottom = "0";
        textDiv.style.overflow = "hidden";
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
  }, [pdf, scale]);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    const rawText = sel?.toString() ?? "";
    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text || text.length < 3) {
      setSelection(null);
      return;
    }

    const anchorNode = sel?.anchorNode;
    let pageEl = anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement;
    while (pageEl && !pageEl.classList?.contains("pdf-page")) {
      pageEl = pageEl.parentElement;
    }

    const pageNumber = pageEl ? Number(pageEl.dataset.pageNumber) : 1;

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

  function zoomIn() {
    const idx = SCALES.indexOf(scale);
    if (idx < SCALES.length - 1) setScale(SCALES[idx + 1]!);
  }

  function zoomOut() {
    const idx = SCALES.indexOf(scale);
    if (idx > 0) setScale(SCALES[idx - 1]!);
  }

  return (
    <div className="relative">
      <div className="mb-2 flex items-center gap-3">
        <span className="text-xs text-muted">{totalPages > 0 ? `${totalPages} pages` : "Loading..."}</span>
        <div className="flex items-center gap-1">
          <button
            className="rounded border border-border px-2 py-0.5 text-sm hover:bg-surface disabled:opacity-30"
            onClick={zoomOut}
            disabled={scale <= SCALES[0]!}
          >
            −
          </button>
          <span className="w-14 text-center text-xs text-muted">{Math.round(scale * 100)}%</span>
          <button
            className="rounded border border-border px-2 py-0.5 text-sm hover:bg-surface disabled:opacity-30"
            onClick={zoomIn}
            disabled={scale >= SCALES[SCALES.length - 1]!}
          >
            +
          </button>
        </div>
      </div>
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
          line-height: 1;
          pointer-events: auto;
        }
        .pdf-text-layer span,
        .pdf-text-layer br {
          color: transparent;
          position: absolute;
          white-space: pre;
          pointer-events: all;
          transform-origin: 0% 0%;
        }
        .pdf-text-layer span::selection {
          background: rgba(37, 111, 143, 0.35);
        }
        .pdf-text-layer .endOfContent {
          display: block;
          position: absolute;
          left: 0;
          top: 100%;
          right: 0;
          bottom: 0;
          z-index: -1;
          cursor: default;
          user-select: none;
        }
      `}</style>
    </div>
  );
}
