import { createHash } from "node:crypto";
import { prisma } from "@paper-viewer/db";
import { isUniqueViolation } from "@/lib/daily-digest";
import { normalizeTitle } from "@/lib/paper-identity";
import { canRenderPdf } from "@/lib/paper-pdf";

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
          // DBLP disambiguates homonyms by appending a number ("Li Jiang 0002"),
          // which is meaningless to a reader. The source repo ships the clean
          // form as display_name and keeps the suffixed one under name for
          // matching; render the former, and fall back for older feeds.
          const author = item as { display_name?: unknown; displayName?: unknown; name?: unknown };
          return (
            asTrimmedString(author.display_name ?? author.displayName) ??
            asTrimmedString(author.name) ??
            ""
          );
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
      // csconf-papers ships arxiv_id since 2026-08 (Semantic Scholar DOI-batch
      // match, exact by construction); the camelCase variants are older shapes.
      arxivId: asTrimmedString(record.arxiv_id ?? record.arxivId ?? record.arxiv) ?? arxivFromUrl
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

/** What importing one feed file changed. */
export type ConferenceImportCounts = {
  entries: number;
  createdPapers: number;
  linkedExisting: number;
  skipped: number;
  removedDuplicates: number;
  /** Catalog links dropped because the feed no longer lists that article. */
  unlinkedStale: number;
  /** Conference rows whose author list the feed corrected. */
  refreshedAuthors: number;
};

export type ConferenceSyncResult = ConferenceImportCounts & {
  files: number;
  /** Which source answered the "which files exist" question. */
  listingTier: ListingTier;
  /** True when that source was not the authoritative manifest. */
  degradedListing: boolean;
  /**
   * Anything that leaves this run less trustworthy than a clean one: a file
   * whose paper count disagreed with the manifest, a checksum that did not
   * match. Returned rather than only logged, because the failure this chain
   * exists to prevent was invisible precisely by looking like success.
   */
  warnings: string[];
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
  return (canRenderPdf(row.paper) ? 2 : 0) + (row.paper.externalUrl ? 1 : 0);
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

/** Prisma hands `authors` back as Json; only an identical string list counts as unchanged. */
export function sameAuthors(stored: unknown, incoming: string[]): boolean {
  if (!Array.isArray(stored) || stored.length !== incoming.length) return false;
  return stored.every((author, index) => author === incoming[index]);
}

/**
 * Catalog links for a venue-year that the current feed no longer lists.
 *
 * An edition's paper list can shrink for real: the SOSP 2026 page kept the
 * previous edition's list in an HTML comment, and fixing the upstream parser
 * removed 43 articles that had never been SOSP 2026 papers. Nothing in the
 * insert-only sync could retract them, so they stayed in the catalog forever.
 *
 * Only the link is stale, never the article — the Paper row is left alone so
 * annotations, comments and library entries made against it survive.
 */
export function staleCatalogEntries(
  rows: { id: string; paperId: string }[],
  livePaperIds: ReadonlySet<string>
): string[] {
  return rows.filter((row) => !livePaperIds.has(row.paperId)).map((row) => row.id);
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
export async function syncConferencePapers(feed: unknown): Promise<ConferenceImportCounts> {
  const { entries, skipped } = parseConferenceFeed(feed);
  if (entries.length === 0) {
    return {
      entries: 0,
      createdPapers: 0,
      linkedExisting: 0,
      skipped,
      removedDuplicates: 0,
      unlinkedStale: 0,
      refreshedAuthors: 0
    };
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
      authors: true,
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
  const backfills = new Map<
    string,
    { externalUrl?: string; pdfUrl?: string; arxivId?: string; authors?: string[] }
  >();
  let refreshedAuthors = 0;
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
    if (entry.arxivId && !row.arxivId && !patch.arxivId) {
      patch.arxivId = entry.arxivId;
    }
    // Authors are the one field re-written rather than only filled in: the
    // upstream repo corrects them after the fact (mojibake from a charset-less
    // response, DBLP's "Li Jiang 0002" homonym suffixes), and writing once at
    // create time would leave every existing row on the broken spelling.
    if (entry.authors.length > 0 && !patch.authors && !sameAuthors(row.authors, entry.authors)) {
      patch.authors = entry.authors;
      refreshedAuthors += 1;
    }
    if (Object.keys(patch).length > 0) {
      backfills.set(paperId!, patch);
    }
  }
  for (const batch of chunk([...backfills.entries()], 25)) {
    await Promise.all(
      batch.map(([paperId, data]) =>
        prisma.paper.update({ where: { id: paperId }, data }).catch(async (error) => {
          // Paper.arxivId is unique: when a digest/import twin already owns the
          // id, keep the rest of the patch and leave the id with the twin —
          // identity resolution merges the two on the next sync anyway.
          if (!isUniqueViolation(error)) {
            throw error;
          }
          const { arxivId: _conflicting, ...rest } = data;
          if (Object.keys(rest).length > 0) {
            await prisma.paper.update({ where: { id: paperId }, data: rest });
          }
        })
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

  // Both passes below work per venue-year touched by this feed.
  const venueYears = [
    ...new Map(entries.map((entry) => [`${entry.venue} ${entry.year}`, { venue: entry.venue, year: entry.year }])).values()
  ];
  // Reconcile the editions this feed covers against what it actually lists.
  const livePaperIds = new Map<string, Set<string>>();
  for (const link of links) {
    const key = `${link.venue} ${link.year}`;
    const bucket = livePaperIds.get(key) ?? new Set<string>();
    bucket.add(link.paperId);
    livePaperIds.set(key, bucket);
  }
  let unlinkedStale = 0;
  for (const { venue, year } of venueYears) {
    const live = livePaperIds.get(`${venue} ${year}`);
    // An edition that resolved to nothing means a parse or fetch problem, not
    // an emptied program — refuse to unlink a whole venue-year on that.
    if (!live || live.size === 0) continue;
    const rows = await prisma.conferenceEntry.findMany({
      where: { venue, year },
      select: { id: true, paperId: true }
    });
    const stale = staleCatalogEntries(rows, live);
    if (stale.length > 0) {
      await prisma.conferenceEntry.deleteMany({ where: { id: { in: stale } } });
      unlinkedStale += stale.length;
    }
  }

  // Self-heal: collapse entries that list the same article twice — both the
  // leftovers of pre-fix flip-flops and anything a future resolution change
  // might introduce.
  const removedDuplicates = await dedupeConferenceEntries(venueYears);

  return {
    entries: entries.length,
    createdPapers: toCreate.length,
    linkedExisting,
    skipped,
    removedDuplicates,
    unlinkedStale,
    refreshedAuthors
  };
}

type GithubContentEntry = { type: string; name: string };

/**
 * Backoff for a transient fetch failure. A catalog import is ~20 sequential
 * requests and the run is all-or-nothing, so a single dropped connection would
 * otherwise cost the whole thing — one was observed mid-import (ECONNRESET
 * before the TLS handshake completed) while every file was in fact being
 * served fine.
 *
 * Only a network error or a 5xx is retried. A 404 must stay fast: that is the
 * signal that moves the listing to its next tier, and a source repo with no
 * manifest would otherwise pay this delay twice before reaching the API.
 */
const FETCH_RETRY_DELAYS_MS = [500, 2_000];

async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const delay = FETCH_RETRY_DELAYS_MS[attempt];
    let response: Response | null = null;
    let networkError: unknown = null;
    try {
      response = await fetch(url, {
        cache: "no-store",
        headers: { "User-Agent": "paper-viewer-conference-sync", ...headers }
      });
    } catch (error) {
      networkError = error;
    }

    if (response?.ok) {
      return response.text();
    }
    // A 4xx is the server's final answer, so surface it without spending the
    // backoff: a 404 is how the listing moves on to its next tier.
    if (response && response.status < 500) {
      throw new Error(`Fetch failed (${response.status}) for ${url}`);
    }
    // Drain a failed body so the connection can be reused.
    await response?.text().catch(() => "");

    if (delay === undefined) {
      throw networkError ?? new Error(`Fetch failed (${response?.status}) for ${url}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

async function fetchJson(url: string, headers: Record<string, string> = {}): Promise<unknown> {
  return JSON.parse(await fetchText(url, headers));
}

/** One data file as the source repo's manifest describes it. */
export type CatalogFile = {
  path: string;
  /** Absent when the listing came from the GitHub API, which knows only paths. */
  paperCount: number | null;
  sha256: string | null;
};

/**
 * Where a listing came from. Only `manifest` is authoritative; the other two
 * are recorded so a run that imported from a degraded source is never
 * indistinguishable from a healthy one.
 */
export type ListingTier = "manifest" | "manifest-mirror" | "github-api";

export type CatalogListing = {
  files: CatalogFile[];
  tier: ListingTier;
  /** The manifest's own total, for a whole-catalog tripwire. Null off the API path. */
  totalPaperCount: number | null;
};

/** Paths the manifest may name: a data file of one venue-year, and nothing else. */
const DATA_FILE_PATH = /^data\/\d{4}\/[^/]+\.json$/;

/**
 * How many papers a feed file holds, counted before parsing so it can be
 * compared against the manifest. Includes rows parseConferenceFeed would skip
 * as malformed — the manifest counts what is in the file, not what survives.
 */
export function paperCountOf(feed: unknown): number {
  if (Array.isArray(feed)) return feed.length;
  const papers = (feed as { papers?: unknown } | null)?.papers;
  return Array.isArray(papers) ? papers.length : 0;
}

/** Over the exact bytes served, which is what the source repo hashes. */
function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/**
 * Read the source repo's data/index.json.
 *
 * A path outside data/{year}/ is dropped rather than trusted: the path is
 * templated into a fetch URL, and a manifest is a file like any other — one
 * bad entry must not be able to point this sync at an arbitrary location.
 */
export function parseCatalogManifest(raw: unknown): Omit<CatalogListing, "tier"> {
  const doc = raw as { files?: unknown; paper_count?: unknown };
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.files)) {
    throw new Error("Manifest has no files array");
  }
  const files: CatalogFile[] = [];
  for (const item of doc.files) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { path?: unknown; paper_count?: unknown; sha256?: unknown };
    const path = asTrimmedString(entry.path);
    if (!path || !DATA_FILE_PATH.test(path)) continue;
    files.push({
      path,
      paperCount: typeof entry.paper_count === "number" ? entry.paper_count : null,
      sha256: asTrimmedString(entry.sha256)
    });
  }
  if (files.length === 0) {
    throw new Error("Manifest lists no data files");
  }
  return {
    files,
    totalPaperCount: typeof doc.paper_count === "number" ? doc.paper_count : null
  };
}

/**
 * Enumerate the catalog's data files.
 *
 * The source repo publishes data/index.json naming every file it ships, with a
 * paper count and a sha256 for each. That exists because raw.githubusercontent
 * serves a file by path and cannot be asked what a directory holds — the only
 * way to discover a venue added since last time is to fetch a file that lists
 * them.
 *
 * jsDelivr's *package listing* API used to answer that question and is no
 * longer asked, in any position. Its listing for a branch is a snapshot frozen
 * at the day the repo was created: it reported 14 files while the repo had 20,
 * so three new venues and a whole edition of SIGMOD went missing for days with
 * every sync reporting success. A source that answers 200 with wrong data
 * cannot sit anywhere in a correctness chain, because nothing downstream can
 * tell its answer from a right one — least of all as the fallback, which would
 * make the recovery path the thing that caused the incident.
 *
 * jsDelivr's *file* CDN is a separate subsystem and is fresh, so it stays on as
 * tier 2 — serving the same manifest over a second CDN, which is real
 * redundancy against a Fastly outage. It caches branch refs, though, so it can
 * hand back a manifest whose checksums lag what raw serves; that is why it
 * counts as degraded. Tier 3 (the GitHub contents API, 60 requests/hour per IP
 * anonymously, honouring GITHUB_TOKEN) exists only for a source repo with no
 * manifest at all. Running out of tiers is a hard failure: importing a subset
 * silently is the bug this whole chain exists to prevent.
 */
export async function listDataFiles(owner: string, repo: string): Promise<CatalogListing> {
  const manifestSources: { tier: ListingTier; url: string }[] = [
    { tier: "manifest", url: `https://raw.githubusercontent.com/${owner}/${repo}/main/data/index.json` },
    { tier: "manifest-mirror", url: `https://cdn.jsdelivr.net/gh/${owner}/${repo}@main/data/index.json` }
  ];
  const failures: string[] = [];
  for (const { tier, url } of manifestSources) {
    try {
      return { ...parseCatalogManifest(await fetchJson(url)), tier };
    } catch (error) {
      failures.push(`${tier}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const headers: Record<string, string> = process.env.GITHUB_TOKEN
      ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
      : {};
    const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents`;
    const years = (await fetchJson(`${apiBase}/data`, headers)) as GithubContentEntry[];
    const files: CatalogFile[] = [];
    for (const yearDir of years) {
      if (yearDir.type !== "dir") continue;
      const listed = (await fetchJson(`${apiBase}/data/${yearDir.name}`, headers)) as GithubContentEntry[];
      for (const file of listed) {
        const path = `data/${yearDir.name}/${file.name}`;
        if (file.type === "file" && DATA_FILE_PATH.test(path)) {
          files.push({ path, paperCount: null, sha256: null });
        }
      }
    }
    if (files.length > 0) {
      return { files, tier: "github-api", totalPaperCount: null };
    }
    failures.push("github-api: listed no data files");
  } catch (error) {
    failures.push(`github-api: ${error instanceof Error ? error.message : String(error)}`);
  }

  throw new Error(`Could not list the catalog's data files — ${failures.join("; ")}`);
}

/**
 * Fetch one data file and check it against what the manifest said it holds.
 *
 * The count is the tripwire: a file that parses fine but carries fewer papers
 * than the manifest claims is the shape of a stale or partial fetch, and it is
 * otherwise indistinguishable from a small conference. One refetch settles the
 * benign case — the manifest was read at T and a monthly sync landed at T+10s —
 * and anything still disagreeing is imported as fetched with a warning. Never
 * silently under-import (the bug this chain exists for), and never abort the
 * whole catalog over one file (that would turn a ten-second race into an
 * outage).
 *
 * The checksum separates two causes that the count alone cannot: bytes that
 * disagree while the count matches mean the manifest is behind the file (the
 * mirror tier caching a branch ref), whereas a different count as well means
 * the repo genuinely moved on.
 */
async function fetchCatalogFile(
  owner: string,
  repo: string,
  file: CatalogFile
): Promise<{ feed: unknown; warnings: string[] }> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/main/${file.path}`;
  const warnings: string[] = [];

  let body = await fetchText(url);
  let feed = JSON.parse(body);
  if (file.paperCount === null) {
    return { feed, warnings };
  }

  if (paperCountOf(feed) !== file.paperCount) {
    body = await fetchText(url);
    feed = JSON.parse(body);
  }

  const actual = paperCountOf(feed);
  if (actual !== file.paperCount) {
    warnings.push(
      `${file.path}: manifest says ${file.paperCount} papers, fetched ${actual} — imported as fetched`
    );
  } else if (file.sha256 && sha256Hex(body) !== file.sha256) {
    // Count agrees but bytes do not: the listing is behind the file, not wrong
    // about it. The papers are fine, so import them and say so.
    warnings.push(`${file.path}: checksum is behind the file served (stale listing, count agrees)`);
  }
  return { feed, warnings };
}

/**
 * Pull the whole catalog: read the manifest to learn which files exist (new
 * years and venues appear without code changes), fetch each from
 * raw.githubusercontent.com, and import file by file.
 *
 * A file that cannot be fetched or parsed fails the run rather than being
 * skipped. Twenty files import as an all-or-nothing set here on purpose: a
 * partial import looks exactly like a complete one in the catalog UI.
 */
export async function syncConferencesFromSource(): Promise<ConferenceSyncResult> {
  const repo = parseGithubRepo(conferenceSourceUrl());
  if (!repo) {
    throw new Error(`CONFERENCE_SOURCE_URL is not a github.com repo URL: ${conferenceSourceUrl()}`);
  }

  const listing = await listDataFiles(repo.owner, repo.repo);
  const totals: ConferenceSyncResult = {
    files: 0,
    entries: 0,
    createdPapers: 0,
    linkedExisting: 0,
    skipped: 0,
    removedDuplicates: 0,
    unlinkedStale: 0,
    refreshedAuthors: 0,
    listingTier: listing.tier,
    degradedListing: listing.tier !== "manifest",
    warnings: []
  };
  if (totals.degradedListing) {
    totals.warnings.push(`listing came from ${listing.tier}, not the source repo's manifest`);
  }

  for (const file of listing.files) {
    const { feed, warnings } = await fetchCatalogFile(repo.owner, repo.repo, file);
    totals.warnings.push(...warnings);
    const result = await syncConferencePapers(feed);
    totals.files += 1;
    totals.entries += result.entries;
    totals.createdPapers += result.createdPapers;
    totals.linkedExisting += result.linkedExisting;
    totals.skipped += result.skipped;
    totals.removedDuplicates += result.removedDuplicates;
    totals.unlinkedStale += result.unlinkedStale;
    totals.refreshedAuthors += result.refreshedAuthors;
  }

  // Whole-catalog tripwire, on top of the per-file one: covers a manifest whose
  // own total disagrees with the files it names.
  if (listing.totalPaperCount !== null && totals.entries + totals.skipped !== listing.totalPaperCount) {
    totals.warnings.push(
      `manifest totals ${listing.totalPaperCount} papers, imported ${totals.entries + totals.skipped}`
    );
  }

  return totals;
}
