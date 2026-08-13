/**
 * The two PDF predicates the UI keeps asking about. Both used to be spelled out
 * inline at every call site, which is how the library badge and the paper page
 * ended up one `blobUrl` apart at one point.
 *
 * They are structurally typed so any Prisma selection carrying the fields works,
 * without every caller having to select more than it needs.
 */

/** Bytes we already hold: an uploaded/attached file, or a pinned Blob snapshot. */
export function hasStoredPdf(paper: { files: unknown[]; blobUrl: string | null }): boolean {
  return paper.files.length > 0 || Boolean(paper.blobUrl);
}

/**
 * Whether the viewer can show *any* inline PDF — stored bytes, or a source the
 * proxy routes can fetch on demand. The browser never touches those hosts
 * directly, so an arXiv id or a publisher pdfUrl is enough.
 */
export function canRenderPdf(paper: {
  arxivId: string | null;
  pdfUrl: string | null;
  blobUrl: string | null;
}): boolean {
  return Boolean(paper.arxivId || paper.pdfUrl || paper.blobUrl);
}

/**
 * A conference paper served from arXiv is the preprint, not the version of
 * record — the reader should be told the text may differ from the published one.
 */
export function isPreprintPdf(paper: {
  source: string;
  arxivId: string | null;
  pdfUrl: string | null;
}): boolean {
  return paper.source === "conference" && Boolean(paper.arxivId) && !paper.pdfUrl;
}
