"use client";

import { useTranslations } from "next-intl";

/**
 * PDF-only zoom: enlarges the document pane alone, re-rasterised sharp —
 * browser zoom scales the whole page and blurs the canvas. Floating over the
 * document so it works at any width; most valuable on a phone.
 *
 * Shared by the annotating viewer and the read-only preview so a paper zooms
 * the same way whether or not it is in the library.
 */
export function PdfZoomControls({
  onZoomOut,
  onFitWidth,
  onZoomIn
}: {
  onZoomOut: () => void;
  onFitWidth: () => void;
  onZoomIn: () => void;
}) {
  const t = useTranslations("pdf");

  return (
    <div className="absolute bottom-3 right-3 z-10 flex overflow-hidden rounded-md border border-border bg-white shadow-overlay">
      <button
        type="button"
        aria-label={t("zoomOut")}
        title={t("zoomOut")}
        className="flex h-8 w-8 items-center justify-center text-base text-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
        onClick={onZoomOut}
      >
        −
      </button>
      <button
        type="button"
        aria-label={t("zoomFitWidth")}
        title={t("zoomFitWidth")}
        className="flex h-8 items-center justify-center border-x border-border px-2 text-xs text-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
        onClick={onFitWidth}
      >
        {t("zoomFitWidthShort")}
      </button>
      <button
        type="button"
        aria-label={t("zoomIn")}
        title={t("zoomIn")}
        className="flex h-8 w-8 items-center justify-center text-base text-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
        onClick={onZoomIn}
      >
        +
      </button>
    </div>
  );
}
