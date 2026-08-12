import { prisma } from "@paper-viewer/db";
import { normalizeTitle } from "./paper-identity";

export type PaperIdentity = {
  title: string;
  doi?: string | null;
  arxivId?: string | null;
};

export type LibraryRow = {
  paperId: string;
  paper: { title: string; doi: string | null; arxivId: string | null };
};

/**
 * The same article often exists as several Paper rows because sources disagree
 * on identifiers (an arXiv row, a conference row without ids, a manual upload).
 * A library must hold it at most once, whichever door it comes through — this
 * matcher is shared by every entry path (save button, PDF upload, URL import).
 */
export function matchDuplicate(rows: LibraryRow[], identity: PaperIdentity): string | null {
  const wantedTitle = normalizeTitle(identity.title);
  const hit = rows.find(
    (entry) =>
      (identity.doi && entry.paper.doi === identity.doi) ||
      (identity.arxivId && entry.paper.arxivId === identity.arxivId) ||
      (wantedTitle.length > 0 && normalizeTitle(entry.paper.title) === wantedTitle)
  );
  return hit?.paperId ?? null;
}

/**
 * Find a visible library row holding the same article. Archived rows do not
 * count: a paper the team removed must not block bringing it back later.
 */
export async function findLibraryDuplicate(
  workspaceId: string,
  identity: PaperIdentity
): Promise<string | null> {
  const rows = await prisma.workspacePaper.findMany({
    where: { workspaceId, state: "visible" },
    select: {
      paperId: true,
      paper: { select: { title: true, doi: true, arxivId: true } }
    }
  });
  return matchDuplicate(rows, identity);
}
