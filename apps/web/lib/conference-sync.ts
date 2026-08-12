import { prisma } from "@paper-viewer/db";
import { isUniqueViolation } from "@/lib/daily-digest";

/**
 * Where the conference catalog lives. PLACEHOLDER: point this at the raw JSON
 * file inside the GitHub repo once it is provided, e.g.
 * https://raw.githubusercontent.com/<owner>/<repo>/main/papers.json
 * Until then the env var stays unset and the sync API reports "not configured".
 */
export function conferenceSourceUrl(): string | null {
  return process.env.CONFERENCE_SOURCE_URL ?? null;
}

export type ConferencePaperInput = {
  venue: string;
  year: number;
  title: string;
  authors: string[];
  abstract: string | null;
  pdfUrl: string | null;
  doi: string | null;
  arxivId: string | null;
};

export type ConferenceFeedParseResult = {
  entries: ConferencePaperInput[];
  skipped: number;
};

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asAuthors(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  if (typeof value === "string") {
    return value
      .split(/[,;]| and /i)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
}

function asYear(value: unknown): number | null {
  const year = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  return Number.isInteger(year) && year >= 1960 && year <= 2100 ? year : null;
}

/**
 * Parse the repo's JSON feed into clean entries. Tolerant on purpose: the
 * exact upstream format is not final, so the parser accepts either a bare
 * array or `{ papers: [...] }`, authors as an array or a delimited string,
 * and drops (counts) anything missing venue/year/title instead of failing
 * the whole sync.
 */
export function parseConferenceFeed(raw: unknown): ConferenceFeedParseResult {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { papers?: unknown[] }).papers)
      ? (raw as { papers: unknown[] }).papers
      : null;
  if (!list) {
    throw new Error("Conference feed is not a JSON array (or { papers: [...] })");
  }

  const entries: ConferencePaperInput[] = [];
  let skipped = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") {
      skipped += 1;
      continue;
    }
    const record = item as Record<string, unknown>;
    const venue = asTrimmedString(record.venue ?? record.conference);
    const year = asYear(record.year);
    const title = asTrimmedString(record.title);
    if (!venue || !year || !title) {
      skipped += 1;
      continue;
    }
    entries.push({
      venue: venue.toUpperCase(),
      year,
      title,
      authors: asAuthors(record.authors),
      abstract: asTrimmedString(record.abstract),
      pdfUrl: asTrimmedString(record.pdfUrl ?? record.pdf ?? record.url),
      doi: asTrimmedString(record.doi),
      arxivId: asTrimmedString(record.arxivId ?? record.arxiv)
    });
  }
  return { entries, skipped };
}

/** Deterministic per-entry identity for papers that carry no DOI/arXiv id. */
export function conferenceSourceId(entry: Pick<ConferencePaperInput, "venue" | "year" | "title">): string {
  const slug = entry.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return `${entry.venue.toLowerCase()}-${entry.year}-${slug}`;
}

/**
 * Find the Paper row this feed entry refers to, if the article is already
 * known under another source (arXiv digest, manual upload). Matching order:
 * arXiv id, DOI, then case-insensitive exact title. Reusing the existing row
 * is what keeps one article from ending up in the library twice via two ids.
 */
async function resolveExistingPaper(entry: ConferencePaperInput): Promise<string | null> {
  if (entry.arxivId) {
    const byArxiv = await prisma.paper.findUnique({ where: { arxivId: entry.arxivId }, select: { id: true } });
    if (byArxiv) return byArxiv.id;
  }
  if (entry.doi) {
    const byDoi = await prisma.paper.findUnique({ where: { doi: entry.doi }, select: { id: true } });
    if (byDoi) return byDoi.id;
  }
  const byTitle = await prisma.paper.findFirst({
    where: { title: { equals: entry.title, mode: "insensitive" } },
    select: { id: true }
  });
  return byTitle?.id ?? null;
}

export type ConferenceSyncResult = {
  entries: number;
  createdPapers: number;
  linkedExisting: number;
  skipped: number;
};

/**
 * Import the conference catalog: raw metadata only — deliberately NO LLM
 * analysis here. A conference paper gets its AI intro only after someone
 * saves it to the library (the save route triggers the analysis).
 * Idempotent: papers dedupe via resolveExistingPaper/source ids, entries via
 * the (venue, year, paperId) unique key.
 */
export async function syncConferencePapers(feed: unknown): Promise<ConferenceSyncResult> {
  const { entries, skipped } = parseConferenceFeed(feed);
  let createdPapers = 0;
  let linkedExisting = 0;

  for (const entry of entries) {
    let paperId = await resolveExistingPaper(entry);
    if (paperId) {
      linkedExisting += 1;
    } else {
      try {
        const created = await prisma.paper.create({
          data: {
            title: entry.title,
            authors: entry.authors,
            abstract: entry.abstract,
            pdfUrl: entry.pdfUrl,
            doi: entry.doi,
            arxivId: entry.arxivId,
            source: "conference",
            sourceId: conferenceSourceId(entry)
          },
          select: { id: true }
        });
        paperId = created.id;
        createdPapers += 1;
      } catch (error) {
        // A concurrent sync (or an id we did not match on) created it first.
        if (!isUniqueViolation(error)) throw error;
        paperId = await resolveExistingPaper(entry);
        if (!paperId) {
          const bySourceId = await prisma.paper.findUnique({
            where: { source_sourceId: { source: "conference", sourceId: conferenceSourceId(entry) } },
            select: { id: true }
          });
          paperId = bySourceId?.id ?? null;
        }
        if (!paperId) throw error;
        linkedExisting += 1;
      }
    }

    await prisma.conferenceEntry.upsert({
      where: { venue_year_paperId: { venue: entry.venue, year: entry.year, paperId } },
      create: { venue: entry.venue, year: entry.year, paperId },
      update: {}
    });
  }

  return { entries: entries.length, createdPapers, linkedExisting, skipped };
}

/** Fetch the configured feed and import it. */
export async function syncConferencesFromSource(): Promise<ConferenceSyncResult> {
  const url = conferenceSourceUrl();
  if (!url) {
    throw new Error("CONFERENCE_SOURCE_URL is not configured");
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Conference feed fetch failed with status ${response.status}`);
  }
  return syncConferencePapers(await response.json());
}
