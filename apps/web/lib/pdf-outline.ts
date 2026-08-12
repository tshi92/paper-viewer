/**
 * Table of contents from a PDF's embedded bookmark tree (pdf.js `getOutline`).
 * arXiv PDFs produced by hyperref carry one almost universally; when absent,
 * the paper simply has no outline UI — no AI fallback in v1.
 */
export type PdfOutlineEntry = {
  title: string;
  /** 1-based page number the bookmark points at. */
  page: number;
  /** 0 = chapter/section, 1 = subsection, … (capped by extraction depth). */
  level: number;
};

/** The sliver of PDFDocumentProxy the extraction needs — mockable in tests. */
export type OutlineCapableDocument = {
  getOutline(): Promise<RawOutlineNode[] | null>;
  getDestination(id: string): Promise<unknown[] | null>;
  getPageIndex(ref: unknown): Promise<number>;
};

export type RawOutlineNode = {
  title: string;
  dest: string | unknown[] | null;
  items: RawOutlineNode[];
};

const MAX_DEPTH = 2;
const MAX_ITEMS = 200;

/**
 * Flattens the bookmark tree into ordered entries with resolved page numbers.
 * Individual bad nodes (broken destinations, dangling refs) are dropped, not
 * fatal; returns [] when the document has no usable outline at all.
 */
export async function extractPdfOutline(document: OutlineCapableDocument): Promise<PdfOutlineEntry[]> {
  let roots: RawOutlineNode[] | null;
  try {
    roots = await document.getOutline();
  } catch {
    return [];
  }
  if (!roots || roots.length === 0) {
    return [];
  }

  const entries: PdfOutlineEntry[] = [];

  async function resolvePage(dest: RawOutlineNode["dest"]): Promise<number | null> {
    try {
      const explicit = typeof dest === "string" ? await document.getDestination(dest) : dest;
      const pageRef = Array.isArray(explicit) ? explicit[0] : null;
      if (pageRef == null) return null;
      return (await document.getPageIndex(pageRef)) + 1;
    } catch {
      return null;
    }
  }

  async function walk(nodes: RawOutlineNode[], level: number): Promise<void> {
    for (const node of nodes) {
      if (entries.length >= MAX_ITEMS) return;
      const title = typeof node.title === "string" ? node.title.trim() : "";
      const page = title ? await resolvePage(node.dest) : null;
      if (title && page !== null) {
        entries.push({ title, page, level });
      }
      if (level + 1 < MAX_DEPTH && Array.isArray(node.items) && node.items.length > 0) {
        await walk(node.items, level + 1);
      }
    }
  }

  await walk(roots, 0);
  return entries;
}
