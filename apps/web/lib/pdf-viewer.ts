/**
 * The pdf.js viewer behaviour shared by both readers — the annotating one on a
 * library paper, and the read-only one on a preview — so a document loads and
 * zooms the same way whichever of them is showing it.
 *
 * Typed structurally rather than against `PDFViewer`: the two readers reach
 * pdf.js through different entry points (one directly, one through
 * react-pdf-highlighter's copy), and only these two properties are touched.
 */
type ZoomableViewer = { currentScale: number; currentScaleValue: string };

/** Served from `public/`; must match the `pdfjs-dist` version in package.json. */
export const PDF_WORKER_SRC = "/pdf.worker.min.mjs";

/** The scale that fills the pane, and the default every document opens at. */
export const FIT_WIDTH = "page-width";

/** One press of the zoom buttons. */
const ZOOM_STEP = 1.2;

/** Clamps, so a runaway tap cannot ask for a 10× canvas. */
const MIN_SCALE = 0.3;
const MAX_SCALE = 5;

/**
 * Zoom the document alone. pdf.js re-rasterises at the new scale, so the text
 * stays sharp — unlike browser zoom, which scales the whole page and blurs the
 * canvas. A viewer that has not finished initialising is simply not zoomed.
 */
export function zoomViewer(
  viewer: ZoomableViewer | null | undefined,
  direction: "in" | "out"
): void {
  if (!viewer) return;
  const factor = direction === "in" ? ZOOM_STEP : 1 / ZOOM_STEP;
  viewer.currentScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewer.currentScale * factor));
}

/** Back to filling the pane. */
export function fitViewerToWidth(viewer: ZoomableViewer | null | undefined): void {
  if (!viewer) return;
  viewer.currentScaleValue = FIT_WIDTH;
}
