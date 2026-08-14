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

export type PixelRect = { left: number; top: number; width: number; height: number };

/**
 * The part of a page's canvas an area annotation covers, in the canvas's own
 * pixels, clamped to what the canvas actually holds. Null when the region and
 * the canvas do not overlap at all.
 *
 * `scale` has to be measured from the canvas rather than taken from
 * `window.devicePixelRatio`. pdf.js does not promise to render at the display's
 * ratio: it caps canvas area, so a large page on a high-ratio screen is
 * rasterised smaller than the screen would suggest. Multiplying by the ratio
 * then indexes past the right or bottom edge, and `drawImage` fills the result
 * with transparent pixels — which is not an error anywhere, just a thumbnail
 * that turns out to be blank.
 */
export function canvasCropRect(
  region: PixelRect,
  scale: number,
  canvasWidth: number,
  canvasHeight: number
): PixelRect | null {
  if (!(scale > 0)) return null;
  const left = Math.max(0, Math.round(region.left * scale));
  const top = Math.max(0, Math.round(region.top * scale));
  const right = Math.min(canvasWidth, Math.round((region.left + region.width) * scale));
  const bottom = Math.min(canvasHeight, Math.round((region.top + region.height) * scale));
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}
