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

const ARXIV_URL_ID = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i;

/** Only a URL the snapshot pipeline can actually download may become pdfUrl:
 * plain .pdf files (USENIX, VLDB) and arXiv links. Publisher "pdf" URLs like
 * dl.acm.org/doi/pdf/... sit behind bot protection (403 even with a browser
 * user agent) and would only produce dead PDF badges — those stay external
 * links. */
function asPdfUrl(value: unknown): string | null {
  const url = asTrimmedString(value);
  if (!url) return null;
  if (/\.pdf($|[?#])/i.test(url)) return url;
  const arxiv = url.match(ARXIV_URL_ID);
  return arxiv ? `https://arxiv.org/pdf/${arxiv[1]}` : null;
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
    // csconf-papers ships an explicit pdf_url since 2026-08; older shapes used
    // pdfUrl/pdf or relied on `url` itself being a .pdf file.
    const explicitPdf = asTrimmedString(record.pdf_url ?? record.pdfUrl ?? record.pdf);
    // An arXiv pdf link also names the paper's arXiv id — capture it so
    // identity resolution can merge with digest/import twins.
    const arxivFromUrl = (explicitPdf ?? rawUrl ?? "").match(ARXIV_URL_ID)?.[1] ?? null;
    entries.push({
      venue: venue.toUpperCase(),
      year,
      title,
      authors: asAuthors(record.authors),
      abstract: asTrimmedString(record.abstract),
      pdfUrl: asPdfUrl(explicitPdf) ?? asPdfUrl(rawUrl),
      externalUrl: rawUrl ?? (doi ? `https://doi.org/${doi}` : null),
      doi,
      arxivId: asTrimmedString(record.arxivId ?? record.arxiv) ?? arxivFromUrl
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
  removedDuplicates: number;
};

export type CatalogEntryRow = {
  id: string;
  paper: {
    title: string;
    arxivId: string | null;
    pdfUrl: string | null;
    blobUrl: string | null;
    externalUrl: string | null;
  };
};

/** Rows that can render an inline PDF outrank bare metadata; a source link breaks ties. */
function catalogRowScore(row: CatalogEntryRow): number {
  const pdfCapable = row.paper.arxivId || row.paper.pdfUrl || row.paper.blobUrl;
  return (pdfCapable ? 2 : 0) + (row.paper.externalUrl ? 1 : 0);
}

/**
 * Catalog entries of one venue-year that list the same article twice. Re-syncs
 * can legitimately re-resolve an article to a different Paper row — an arXiv
 * or uploaded twin that did not exist at the first import — and the
 * (venue, year, paperId) unique key cannot see that. Within one venue-year an
 * identical normalized title IS the same article, so each title group keeps
 * exactly one entry (the highest-scoring row) and the rest are surplus.
 */
export function surplusCatalogEntries(rows: CatalogEntryRow[]): string[] {
  const groups = new Map<string, CatalogEntryRow[]>();
  for (const row of rows) {
    const key = normalizeTitle(row.paper.title);
    if (!key) continue;
    const bucket = groups.get(key) ?? [];
    bucket.push(row);
    groups.set(key, bucket);
  }

  const surplus: string[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    const keep = [...bucket].sort((a, b) => catalogRowScore(b) - catalogRowScore(a))[0]!;
    for (const row of bucket) {
      if (row.id !== keep.id) surplus.push(row.id);
    }
  }
  return surplus;
}

/** Delete duplicate catalog entries for the given venue-years; returns how many were removed. */
async function dedupeConferenceEntries(pairs: { venue: string; year: number }[]): Promise<number> {
  let removed = 0;
  for (const { venue, year } of pairs) {
    const rows = await prisma.conferenceEntry.findMany({
      where: { venue, year },
      select: {
        id: true,
        paper: { select: { title: true, arxivId: true, pdfUrl: true, blobUrl: true, externalUrl: true } }
      }
    });
    const surplus = surplusCatalogEntries(rows);
    if (surplus.length > 0) {
      await prisma.conferenceEntry.deleteMany({ where: { id: { in: surplus } } });
      removed += surplus.length;
    }
  }
  return removed;
}

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
    return { entries: 0, createdPapers: 0, linkedExisting: 0, skipped, removedDuplicates: 0 };
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
    select: {
      id: true,
      title: true,
      doi: true,
      arxivId: true,
      sourceId: true,
      source: true,
      externalUrl: true,
      pdfUrl: true,
      blobUrl: true
    }
  });

  const byArxiv = new Map(existing.filter((p) => p.arxivId).map((p) => [p.arxivId!, p.id]));
  const byDoi = new Map(existing.filter((p) => p.doi).map((p) => [p.doi!, p.id]));
  // Several rows can share a title (a conference shell next to an arXiv or
  // uploaded twin). Resolution must be deterministic and prefer the row that
  // can show a PDF — last-write-wins here made re-syncs flip targets and
  // list the article twice in the catalog.
  const titleScore = (p: (typeof existing)[number]) =>
    (p.arxivId || p.pdfUrl || p.blobUrl ? 2 : 0) + (p.externalUrl ? 1 : 0);
  const byTitle = new Map<string, string>();
  const byTitleScore = new Map<string, number>();
  for (const paper of existing) {
    const key = normalizeTitle(paper.title);
    const score = titleScore(paper);
    if (!byTitle.has(key) || score > (byTitleScore.get(key) ?? -1)) {
      byTitle.set(key, paper.id);
      byTitleScore.set(key, score);
    }
  }
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

  // Later syncs can learn links the first import lacked (DBLP indexes a venue
  // after its website listing; the source repo grew pdf_url in 2026-08).
  // Backfill our own conference rows only — papers matched from other sources
  // keep their own metadata — and only fields still empty.
  const conferenceRows = new Map(
    existing.filter((p) => p.source === "conference").map((p) => [p.id, p])
  );
  const backfills = new Map<string, { externalUrl?: string; pdfUrl?: string }>();
  for (const entry of entries) {
    const paperId = resolve(entry);
    const row = paperId ? conferenceRows.get(paperId) : undefined;
    if (!row) continue;
    const patch = backfills.get(paperId!) ?? {};
    if (entry.externalUrl && !row.externalUrl && !patch.externalUrl) {
      patch.externalUrl = entry.externalUrl;
    }
    if (entry.pdfUrl && !row.pdfUrl && !patch.pdfUrl) {
      patch.pdfUrl = entry.pdfUrl;
    }
    if (Object.keys(patch).length > 0) {
      backfills.set(paperId!, patch);
    }
  }
  for (const batch of chunk([...backfills.entries()], 25)) {
    await Promise.all(
      batch.map(([paperId, data]) => prisma.paper.update({ where: { id: paperId }, data }))
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

  // Self-heal: collapse entries that list the same article twice — both the
  // leftovers of pre-fix flip-flops and anything a future resolution change
  // might introduce. Runs per venue-year touched by this feed.
  const venueYears = [
    ...new Map(entries.map((entry) => [`${entry.venue} ${entry.year}`, { venue: entry.venue, year: entry.year }])).values()
  ];
  const removedDuplicates = await dedupeConferenceEntries(venueYears);

  return { entries: entries.length, createdPapers: toCreate.length, linkedExisting, skipped, removedDuplicates };
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
  const totals: ConferenceSyncResult = {
    files: 0,
    entries: 0,
    createdPapers: 0,
    linkedExisting: 0,
    skipped: 0,
    removedDuplicates: 0
  };

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
    totals.removedDuplicates += result.removedDuplicates;
  }

  return totals;
}
