import { prisma } from "@paper-viewer/db";
import { normalizeTitle } from "@/lib/paper-identity";

/**
 * The conference catalog source: a GitHub repo (default: RealZST/csconf-papers)
 * holding accepted-paper lists as data/{year}/{VENUE}.json, each file shaped
 * { meta: { venue, year, ... }, papers: [...] } and generated from DBLP.
 * CONFERENCE_SOURCE_URL overrides the repo (a github.com/{owner}/{repo} URL).
 */
const DEFAULT_SOURCE_REPO = "https://github.com/RealZST/csconf-papers";

export function conferenceSourceUrl(): string {
  const configured = process.env.CONFERENCE_SOURCE_URL;
  return configured && configured.trim().length > 0 ? configured.trim() : DEFAULT_SOURCE_REPO;
}

/** Extracts owner/repo from a github.com URL (tolerates .git and trailing paths). */
export function parseGithubRepo(url: string): { owner: string; repo: string } | null {
  const match = /github\.com\/([^/]+)\/([^/?#]+)/.exec(url);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!.replace(/\.git$/, "") };
}

export type ConferencePaperInput = {
  venue: string;
  year: number;
  title: string;
  authors: string[];
  abstract: string | null;
  pdfUrl: string | null;
  /** Publisher/USENIX/DOI landing page — the paper's canonical home. */
  externalUrl: string | null;
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

/** Authors arrive as strings, {name} objects (DBLP), or a delimited string. */
function asAuthors(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (item && typeof item === "object") {
          return asTrimmedString((item as { name?: unknown }).name) ?? "";
        }
        return "";
      })
      .filter(Boolean);
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

/** Only a URL that plainly serves a PDF may become pdfUrl: the snapshot
 * pipeline downloads it verbatim, and a DOI landing page would be garbage. */
function asPdfUrl(value: unknown): string | null {
  const url = asTrimmedString(value);
  return url && /\.pdf($|[?#])/i.test(url) ? url : null;
}

/**
 * Parse one feed file into clean entries. Accepts the csconf-papers shape
 * ({ meta, papers }) as well as a bare array; per-item venue/year win over
 * the file-level meta. Entries missing venue/year/title are counted, not
 * fatal — one malformed row must not sink a 2000-paper sync.
 */
export function parseConferenceFeed(raw: unknown): ConferenceFeedParseResult {
  let list: unknown[] | null = null;
  let metaVenue: string | null = null;
  let metaYear: number | null = null;

  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === "object") {
    const container = raw as { papers?: unknown; meta?: { venue?: unknown; year?: unknown } };
    if (Array.isArray(container.papers)) {
      list = container.papers;
      metaVenue = asTrimmedString(container.meta?.venue);
      metaYear = asYear(container.meta?.year);
    }
  }
  if (!list) {
    throw new Error("Conference feed is not a JSON array (or { meta, papers })");
  }

  const entries: ConferencePaperInput[] = [];
  let skipped = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") {
      skipped += 1;
      continue;
    }
    const record = item as Record<string, unknown>;
    const venue = asTrimmedString(record.venue ?? record.conference) ?? metaVenue;
    const year = asYear(record.year) ?? metaYear;
    const title = asTrimmedString(record.title);
    if (!venue || !year || !title) {
      skipped += 1;
      continue;
    }
    const doi = asTrimmedString(record.doi);
    const rawUrl = asTrimmedString(record.url ?? record.ee);
    entries.push({
      venue: venue.toUpperCase(),
      year,
      title,
      authors: asAuthors(record.authors),
      abstract: asTrimmedString(record.abstract),
      pdfUrl: asPdfUrl(record.pdfUrl ?? record.pdf ?? rawUrl),
      externalUrl: rawUrl ?? (doi ? `https://doi.org/${doi}` : null),
      doi,
      arxivId: asTrimmedString(record.arxivId ?? record.arxiv)
    });
  }
  return { entries, skipped };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
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

export type ConferenceSyncResult = {
  files: number;
  entries: number;
  createdPapers: number;
  linkedExisting: number;
  skipped: number;
};

/**
 * Import one parsed feed (typically one venue-year file) in a fixed number of
 * queries instead of per-paper lookups: resolve identities in bulk (arXiv id →
 * DOI → normalized title → conference sourceId), createMany the rest, then
 * createMany the catalog links. Raw metadata only — deliberately NO LLM calls:
 * a conference paper gets its AI intro only after someone saves it to the
 * library (the save route triggers the analysis). Idempotent throughout via
 * skipDuplicates and the (venue, year, paperId) unique key.
 */
export async function syncConferencePapers(feed: unknown): Promise<Omit<ConferenceSyncResult, "files">> {
  const { entries, skipped } = parseConferenceFeed(feed);
  if (entries.length === 0) {
    return { entries: 0, createdPapers: 0, linkedExisting: 0, skipped };
  }

  const arxivIds = [...new Set(entries.map((entry) => entry.arxivId).filter((id): id is string => Boolean(id)))];
  const dois = [...new Set(entries.map((entry) => entry.doi).filter((id): id is string => Boolean(id)))];
  const titles = [...new Set(entries.map((entry) => entry.title))];
  const sourceIds = entries.map((entry) => conferenceSourceId(entry));

  const existing = await prisma.paper.findMany({
    where: {
      OR: [
        ...(arxivIds.length ? [{ arxivId: { in: arxivIds } }] : []),
        ...(dois.length ? [{ doi: { in: dois } }] : []),
        { title: { in: titles, mode: "insensitive" as const } },
        { source: "conference", sourceId: { in: sourceIds } }
      ]
    },
    select: { id: true, title: true, doi: true, arxivId: true, sourceId: true, source: true, externalUrl: true }
  });

  const byArxiv = new Map(existing.filter((p) => p.arxivId).map((p) => [p.arxivId!, p.id]));
  const byDoi = new Map(existing.filter((p) => p.doi).map((p) => [p.doi!, p.id]));
  const byTitle = new Map(existing.map((p) => [normalizeTitle(p.title), p.id]));
  const bySourceId = new Map(
    existing.filter((p) => p.source === "conference" && p.sourceId).map((p) => [p.sourceId!, p.id])
  );

  const resolve = (entry: ConferencePaperInput): string | null =>
    (entry.arxivId && byArxiv.get(entry.arxivId)) ||
    (entry.doi && byDoi.get(entry.doi)) ||
    byTitle.get(normalizeTitle(entry.title)) ||
    bySourceId.get(conferenceSourceId(entry)) ||
    null;

  let linkedExisting = 0;
  const toCreate: ConferencePaperInput[] = [];
  for (const entry of entries) {
    if (resolve(entry)) {
      linkedExisting += 1;
    } else {
      toCreate.push(entry);
    }
  }

  if (toCreate.length > 0) {
    // skipDuplicates absorbs same-title collisions inside one feed as well as
    // races with a concurrent sync; the re-query below picks the winners up.
    await prisma.paper.createMany({
      data: toCreate.map((entry) => ({
        title: entry.title,
        authors: entry.authors,
        abstract: entry.abstract,
        pdfUrl: entry.pdfUrl,
        externalUrl: entry.externalUrl,
        doi: entry.doi,
        arxivId: entry.arxivId,
        source: "conference",
        sourceId: conferenceSourceId(entry)
      })),
      skipDuplicates: true
    });
    const created = await prisma.paper.findMany({
      where: { source: "conference", sourceId: { in: toCreate.map((entry) => conferenceSourceId(entry)) } },
      select: { id: true, sourceId: true }
    });
    for (const paper of created) {
      bySourceId.set(paper.sourceId!, paper.id);
    }
  }

  // Later syncs can learn a link the first import lacked (DBLP indexes a
  // venue after its website listing). Backfill our own conference rows only —
  // papers matched from other sources keep their own metadata.
  const missingUrl = new Map(
    existing
      .filter((p) => p.source === "conference" && !p.externalUrl)
      .map((p) => [p.id, true])
  );
  const urlBackfills = new Map<string, string>();
  for (const entry of entries) {
    const paperId = resolve(entry);
    if (paperId && entry.externalUrl && missingUrl.has(paperId) && !urlBackfills.has(paperId)) {
      urlBackfills.set(paperId, entry.externalUrl);
    }
  }
  for (const batch of chunk([...urlBackfills.entries()], 25)) {
    await Promise.all(
      batch.map(([paperId, externalUrl]) =>
        prisma.paper.update({ where: { id: paperId }, data: { externalUrl } })
      )
    );
  }

  const links: { venue: string; year: number; paperId: string }[] = [];
  for (const entry of entries) {
    const paperId = resolve(entry);
    if (paperId) {
      links.push({ venue: entry.venue, year: entry.year, paperId });
    }
  }
  await prisma.conferenceEntry.createMany({ data: links, skipDuplicates: true });

  return { entries: entries.length, createdPapers: toCreate.length, linkedExisting, skipped };
}

type GithubContentEntry = { type: string; name: string };

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "User-Agent": "paper-viewer-conference-sync", ...headers }
  });
  if (!response.ok) {
    throw new Error(`Fetch failed (${response.status}) for ${url}`);
  }
  return response.json();
}

/**
 * Enumerate data/{year}/{VENUE}.json paths. jsDelivr first: api.github.com
 * rate-limits anonymous calls per source IP, and shared serverless egress IPs
 * (Vercel) have that budget permanently exhausted. The GitHub contents API is
 * only a fallback, honouring GITHUB_TOKEN when one is configured.
 */
async function listDataFiles(owner: string, repo: string): Promise<string[]> {
  try {
    const listing = (await fetchJson(
      `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@main?structure=flat`
    )) as { files?: { name: string }[] };
    const files = (listing.files ?? [])
      .map((file) => file.name)
      .filter((name) => /^\/data\/\d{4}\/[^/]+\.json$/.test(name))
      .map((name) => name.slice(1));
    if (files.length > 0) {
      return files;
    }
  } catch {
    // fall through to the GitHub API
  }

  const headers: Record<string, string> = process.env.GITHUB_TOKEN
    ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {};
  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`;
  const years = (await fetchJson(`${apiBase}/data`, headers)) as GithubContentEntry[];
  const paths: string[] = [];
  for (const yearDir of years) {
    if (yearDir.type !== "dir") continue;
    const files = (await fetchJson(`${apiBase}/data/${yearDir.name}`, headers)) as GithubContentEntry[];
    for (const file of files) {
      if (file.type === "file" && file.name.endsWith(".json")) {
        paths.push(`data/${yearDir.name}/${file.name}`);
      }
    }
  }
  return paths;
}

/**
 * Pull the whole catalog: enumerate the data files (new years and venues
 * appear without code changes), fetch each from raw.githubusercontent.com
 * (not rate-limited like the API), and import file by file.
 */
export async function syncConferencesFromSource(): Promise<ConferenceSyncResult> {
  const repo = parseGithubRepo(conferenceSourceUrl());
  if (!repo) {
    throw new Error(`CONFERENCE_SOURCE_URL is not a github.com repo URL: ${conferenceSourceUrl()}`);
  }

  const paths = await listDataFiles(repo.owner, repo.repo);
  const totals: ConferenceSyncResult = { files: 0, entries: 0, createdPapers: 0, linkedExisting: 0, skipped: 0 };

  for (const path of paths) {
    const feed = await fetchJson(
      `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/main/${path}`
    );
    const result = await syncConferencePapers(feed);
    totals.files += 1;
    totals.entries += result.entries;
    totals.createdPapers += result.createdPapers;
    totals.linkedExisting += result.linkedExisting;
    totals.skipped += result.skipped;
  }

  return totals;
}
