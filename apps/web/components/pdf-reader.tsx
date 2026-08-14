"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { EventBus, LinkTarget, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer.mjs";
import "pdfjs-dist/web/pdf_viewer.css";
import { PdfZoomControls } from "./pdf-zoom-controls";
import { MAX_SCALE, MIN_SCALE, PDF_WORKER_SRC, ZOOM_STEP } from "@/lib/pdf-viewer";

/**
 * Read-only PDF viewer for papers that are not in the library yet.
 *
 * This used to be an `<iframe>` pointing at the file, handing the job to the
 * browser's built-in PDF plugin. Every iOS browser is WebKit, and WebKit
 * renders a framed PDF as a single static page: the preview showed page one
 * and nothing else, with no way to scroll on to page two. There is no viewport
 * or sizing fix for that — the frame simply has no viewer in it — so the pages
 * are rendered here instead, by the same pdf.js the library page already runs.
 *
 * Deliberately the same engine on every device rather than a phones-only
 * branch: one renderer means one set of behaviours to keep working, and a
 * paper that is saved mid-read then looks and zooms exactly as it did.
 */
export function PdfReader({ url, title }: { url: string; title: string }) {
  const t = useTranslations("pdf");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<PDFViewer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    setStatus("loading");
    GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

    // Everything this effect subscribes to comes off on one signal, including
    // pdf.js's own listeners — React's dev-mode double mount would otherwise
    // leave a discarded viewer observing the container it no longer owns.
    const teardown = new AbortController();
    const { signal } = teardown;

    const eventBus = new EventBus();
    // Links inside the document: internal ones jump within this viewer,
    // external ones open in a new tab rather than navigating the app away.
    const linkService = new PDFLinkService({ eventBus, externalLinkTarget: LinkTarget.BLANK });
    const viewer = new PDFViewer({
      container,
      eventBus,
      linkService,
      // pdf.js reads this to drop its resize observer and scroll listener; the
      // shipped types predate the option.
      abortSignal: signal
    } as ConstructorParameters<typeof PDFViewer>[0]);
    linkService.setViewer(viewer);
    viewerRef.current = viewer;

    // Pages have no size until the document is in, so the initial fit has to
    // wait for `pagesinit`.
    eventBus.on(
      "pagesinit",
      () => {
        viewer.currentScaleValue = "page-width";
        setStatus("ready");
      },
      { signal }
    );

    // Re-applying a named scale is what recomputes it, so a rotated phone or a
    // resized window re-fits — unless the reader has zoomed by hand, whose
    // numeric scale must survive.
    const resizeObserver = new ResizeObserver(() => {
      if (viewer.currentScaleValue === "page-width") viewer.currentScaleValue = "page-width";
    });
    resizeObserver.observe(container);

    const loadingTask = getDocument(url);
    loadingTask.promise.then(
      (pdfDocument) => {
        if (signal.aborted) return;
        linkService.setDocument(pdfDocument);
        viewer.setDocument(pdfDocument);
      },
      () => {
        if (!signal.aborted) setStatus("error");
      }
    );

    return () => {
      teardown.abort();
      resizeObserver.disconnect();
      viewerRef.current = null;
      // Tears the page views down before the task that owns their data goes.
      viewer.setDocument(null as unknown as Parameters<PDFViewer["setDocument"]>[0]);
      void loadingTask.destroy();
    };
  }, [url]);

  const zoomBy = useCallback((factor: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    // pdf.js re-rasterises at the new scale, so the text stays sharp. The clamp
    // keeps a runaway tap from rendering a 10× canvas.
    viewer.currentScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewer.currentScale * factor));
  }, []);

  return (
    <div
      className="relative h-[calc(100vh-3rem)] overflow-hidden rounded border border-border bg-surface"
      aria-label={title}
      role="document"
    >
      <PdfZoomControls
        onZoomOut={() => zoomBy(1 / ZOOM_STEP)}
        onFitWidth={() => {
          const viewer = viewerRef.current;
          if (viewer) viewer.currentScaleValue = "page-width";
        }}
        onZoomIn={() => zoomBy(ZOOM_STEP)}
      />
      {/* pdf.js requires an absolutely positioned scroll container whose first
          child is the `.pdfViewer` page stack, and populates that stack itself. */}
      <div ref={containerRef} className="absolute inset-0 overflow-auto">
        <div className="pdfViewer" />
      </div>
      {status === "ready" ? null : (
        <p className="pointer-events-none absolute inset-x-0 top-0 p-4 text-sm text-muted">
          {status === "error" ? t("error") : t("loading")}
        </p>
      )}
    </div>
  );
}
