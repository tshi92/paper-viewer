export type PaperIdentityInput = {
  arxivId?: string | null;
  doi?: string | null;
};

export type NormalizedPaperIdentity = {
  arxivId: string | null;
  doi: string | null;
};

export function normalizePaperIdentity(input: PaperIdentityInput): NormalizedPaperIdentity {
  const arxivId = input.arxivId?.trim().replace(/^arxiv:/i, "") || null;
  const doi = input.doi?.trim().toLowerCase() || null;

  return { arxivId, doi };
}
