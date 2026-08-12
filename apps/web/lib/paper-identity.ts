/**
 * Canonical form for comparing paper titles across sources (arXiv digest vs
 * conference feed vs manual upload): lowercase, punctuation and whitespace
 * collapsed. Two papers with the same normalized title are treated as the
 * same article by the save-to-library duplicate check.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
