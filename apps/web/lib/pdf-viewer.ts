/**
 * Settings shared by the two pdf.js viewers — the annotating one on a library
 * paper, and the read-only one on a preview — so a document loads and zooms
 * the same way whichever of them is showing it.
 */

/** Served from `public/`; must match the `pdfjs-dist` version in package.json. */
export const PDF_WORKER_SRC = "/pdf.worker.min.mjs";

/** One press of the zoom buttons. */
export const ZOOM_STEP = 1.2;

/** Clamps, so a runaway tap cannot ask for a 10× canvas. */
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 5;
