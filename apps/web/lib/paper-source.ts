/**
 * Where a paper in the library came from.
 *
 * `Paper.source` alone cannot answer this. A paper that arrived through the
 * conference catalog stores the literal string "conference", with the venue and
 * year living in its ConferenceEntry rows — so a library row rendered from
 * `source` said "conference" and left out the only part a reader wants ("SOSP
 * 2026"). Identity resolution also means a paper can carry `source: "arxiv"`
 * *and* a conference entry, once its preprint is matched to an accepted paper.
 *
 * One function decides both the label on the row and the key the filter
 * dropdown compares against, so a paper can never be listed under one source
 * and filtered under another.
 */

export type ConferenceRef = { venue: string; year: number };

export type PaperSourceRef = {
  source: string;
  conferenceEntries?: ReadonlyArray<ConferenceRef> | null;
};

export type PaperSource =
  | { kind: "conference"; venue: string; year: number }
  | { kind: "arxiv" }
  | { kind: "manual" }
  | { kind: "other"; source: string };

/** Sources that are arXiv under a different importer's name. */
const ARXIV_SOURCES = new Set(["arxiv", "hermes"]);

/**
 * Conference membership wins over `source`: for a paper that is both a preprint
 * and an accepted SOSP 2026 paper, the venue is the fact worth showing — the
 * arXiv id is on the row anyway. A paper listed in more than one edition takes
 * the most recent, so a re-run at a newer venue does not fall back to an old one.
 */
export function paperSource(paper: PaperSourceRef): PaperSource {
  const entries = paper.conferenceEntries ?? [];
  if (entries.length > 0) {
    const newest = [...entries].sort(
      (a, b) => b.year - a.year || a.venue.localeCompare(b.venue)
    )[0]!;
    return { kind: "conference", venue: newest.venue, year: newest.year };
  }
  if (ARXIV_SOURCES.has(paper.source)) return { kind: "arxiv" };
  if (paper.source === "manual") return { kind: "manual" };
  return { kind: "other", source: paper.source };
}

/**
 * The `?source=` value for a source. Conference keys carry the edition, so
 * "SOSP 2026" and "SOSP 2025" are separate filter options rather than one
 * undifferentiated "conference" bucket.
 */
export function sourceFilterKey(source: PaperSource): string {
  switch (source.kind) {
    case "conference":
      return `conf:${source.venue}:${source.year}`;
    case "other":
      return `src:${source.source}`;
    default:
      return source.kind;
  }
}

/** Sort order for the filter options: newest edition first, then venue A-Z. */
export function compareConferenceRefs(a: ConferenceRef, b: ConferenceRef): number {
  return b.year - a.year || a.venue.localeCompare(b.venue);
}
