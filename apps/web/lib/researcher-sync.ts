import { prisma } from "@paper-viewer/db";
import { conferenceSourceUrl, fetchJson, parseGithubRepo } from "@/lib/conference-sync";
import { completeJson } from "@/lib/llm";
import { resolveLlmConfig } from "@/lib/llm-config";
import { directionPrompt } from "@/lib/prompts";
import { DIRECTION_IDS, OTHER_DIRECTION_ID, fromIsoDay, windowStart } from "@/lib/researchers";

/**
 * The Researchers page's ingest: csconf-papers' data/researchers.json into the
 * shared Paper table, then one direction per paper in each workspace. Run by
 * lib/researcher-run.ts; upstream only changes every other Monday, so the
 * common daily run reads, finds nothing new and stops after two queries.
 *
 * The file is a rolling window (the last 91 days per researcher) and this
 * database is the archive: the sync only ever adds papers and links (or
 * corrects a link's position). A paper that has left the file keeps its row
 * and its link. The one removal-like step is deactivating a researcher the
 * file no longer lists at all.
 */

const FILE_PATH = "data/researchers.json";

// ------------------------------------------------------------------ parsing

export type FeedPaper = {
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  /** YYYY-MM-DD */
  published: string;
  /** 1-based position of the researcher in `authors`. */
  position: number;
};
export type FeedResearcher = { slug: string; name: string; affiliation: string; knownFor: string; papers: FeedPaper[] };
export type ResearchersFile = { generated: string; researchers: FeedResearcher[]; skippedPapers: number };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ARXIV_ID = /^\d{4}\.\d{4,5}$|^[a-z-]+(\.[A-Z]{2})?\/\d{7}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * A malformed paper is skipped and counted; a malformed researcher fails the
 * whole file, because a researcher missing from a run is deactivated — one bad
 * entry must not quietly take someone off the page.
 */
export function parseResearchersFile(raw: unknown): ResearchersFile {
  const doc = (raw ?? {}) as { schema?: unknown; generated?: unknown; researchers?: unknown };
  if (doc.schema !== 1) {
    throw new Error(`researchers.json schema ${String(doc.schema)} is not 1`);
  }
  if (!Array.isArray(doc.researchers) || doc.researchers.length === 0) {
    // An empty list would deactivate everyone: a broken file, not an empty roster.
    throw new Error("researchers.json lists no researchers");
  }
  const seen = new Set<string>();
  let skippedPapers = 0;
  const researchers = doc.researchers.map((item): FeedResearcher => {
    const r = (item ?? {}) as Record<string, unknown>;
    const slug = str(r.slug);
    const name = str(r.name);
    if (!SLUG.test(slug) || !name) {
      throw new Error(`researchers.json: bad researcher entry ${JSON.stringify(slug)}`);
    }
    if (seen.has(slug)) {
      throw new Error(`researchers.json: duplicate slug ${slug}`);
    }
    seen.add(slug);
    const papers: FeedPaper[] = [];
    for (const entry of Array.isArray(r.papers) ? r.papers : []) {
      const parsed = parsePaper(entry);
      if (parsed) papers.push(parsed);
      else skippedPapers += 1;
    }
    return { slug, name, affiliation: str(r.affiliation), knownFor: str(r.known_for), papers };
  });
  return { generated: str(doc.generated), researchers, skippedPapers };
}

function parsePaper(raw: unknown): FeedPaper | null {
  const p = (raw ?? {}) as Record<string, unknown>;
  const arxivId = str(p.arxiv_id);
  const title = str(p.title);
  const authors = Array.isArray(p.authors) ? p.authors.map(str).filter(Boolean) : [];
  const published = str(p.published).slice(0, 10);
  const position = Number(p.position);
  const valid =
    ARXIV_ID.test(arxivId) && title.length > 0 && authors.length > 0 && DATE.test(published) &&
    Number.isInteger(position) && position >= 1 && position <= authors.length;
  return valid ? { arxivId, title, abstract: str(p.abstract), authors, published, position } : null;
}

// ------------------------------------------------------------ what changed

type StoredResearcher = { slug: string; name: string; affiliation: string; knownFor: string; active: boolean };
type StoredLink = { researcherSlug: string; paperId: string; arxivId: string | null; position: number };

export type SyncPlan = {
  /** New, changed, or returning (inactive) researchers. */
  upserts: FeedResearcher[];
  /** Active researchers the file no longer lists. */
  deactivate: string[];
  newLinks: { slug: string; paper: FeedPaper }[];
  /** Links whose author position upstream corrected. */
  moved: { slug: string; paperId: string; position: number }[];
};

/**
 * Pure diff of the file against the database; the sync writes only this.
 * There is deliberately no "unlink" output: links in the database that the
 * rolling file no longer mentions are the archive and are left untouched.
 */
export function planSync(file: ResearchersFile, stored: StoredResearcher[], links: StoredLink[]): SyncPlan {
  const storedBySlug = new Map(stored.map((r) => [r.slug, r]));
  const linkByKey = new Map(links.filter((l) => l.arxivId).map((l) => [`${l.researcherSlug} ${l.arxivId}`, l]));
  const fileSlugs = new Set(file.researchers.map((r) => r.slug));
  const plan: SyncPlan = { upserts: [], deactivate: [], newLinks: [], moved: [] };
  for (const r of file.researchers) {
    const s = storedBySlug.get(r.slug);
    if (!s || !s.active || s.name !== r.name || s.affiliation !== r.affiliation || s.knownFor !== r.knownFor) {
      plan.upserts.push(r);
    }
    for (const paper of r.papers) {
      const link = linkByKey.get(`${r.slug} ${paper.arxivId}`);
      if (!link) plan.newLinks.push({ slug: r.slug, paper });
      else if (link.position !== paper.position) plan.moved.push({ slug: r.slug, paperId: link.paperId, position: paper.position });
    }
  }
  plan.deactivate = stored.filter((s) => s.active && !fileSlugs.has(s.slug)).map((s) => s.slug);
  return plan;
}

export const isNoop = (plan: SyncPlan): boolean =>
  !plan.upserts.length && !plan.deactivate.length && !plan.newLinks.length && !plan.moved.length;

/**
 * A paper can already exist as a conference catalog row (matched by arXiv id,
 * which csconf ships for conference papers). Those rows are created without
 * publishedAt and usually without an abstract (conference-sync.ts), and a
 * researcher paper without publishedAt would fall out of every window query.
 * Fill only what is still empty — the same rule as the conference backfill.
 */
export function backfillPatches(
  feed: FeedPaper[],
  existing: { id: string; arxivId: string | null; abstract: string | null; publishedAt: Date | null }[]
): Map<string, { abstract?: string; publishedAt?: Date }> {
  const byArxiv = new Map(feed.map((p) => [p.arxivId, p]));
  const patches = new Map<string, { abstract?: string; publishedAt?: Date }>();
  for (const row of existing) {
    const p = row.arxivId ? byArxiv.get(row.arxivId) : undefined;
    if (!p) continue;
    const patch: { abstract?: string; publishedAt?: Date } = {};
    if (!row.abstract?.trim() && p.abstract) patch.abstract = p.abstract;
    if (!row.publishedAt) patch.publishedAt = fromIsoDay(p.published);
    if (Object.keys(patch).length > 0) patches.set(row.id, patch);
  }
  return patches;
}

// -------------------------------------------------------------------- sync

export type ResearcherSyncResult = {
  generated: string;
  researchers: number;
  skippedPapers: number;
  upserted: number;
  deactivated: number;
  /** Papers that joined the page: linked to a tracked researcher for the first time. */
  newPapers: number;
  linked: number;
  createdPapers: number;
  backfilled: number;
  moved: number;
};

export async function syncResearchers(): Promise<ResearcherSyncResult> {
  const repo = parseGithubRepo(conferenceSourceUrl());
  if (!repo) {
    throw new Error(`CONFERENCE_SOURCE_URL is not a github.com repo URL: ${conferenceSourceUrl()}`);
  }
  const file = parseResearchersFile(
    await fetchJson(`https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/main/${FILE_PATH}`)
  );
  const [stored, links] = await Promise.all([
    prisma.researcher.findMany({ select: { slug: true, name: true, affiliation: true, knownFor: true, active: true } }),
    prisma.researcherPaper.findMany({
      select: { researcherSlug: true, paperId: true, position: true, paper: { select: { arxivId: true } } }
    })
  ]);
  const plan = planSync(
    file,
    stored,
    links.map((l) => ({ researcherSlug: l.researcherSlug, paperId: l.paperId, position: l.position, arxivId: l.paper.arxivId }))
  );
  const result: ResearcherSyncResult = {
    generated: file.generated, researchers: file.researchers.length, skippedPapers: file.skippedPapers,
    upserted: plan.upserts.length, deactivated: plan.deactivate.length, moved: plan.moved.length,
    newPapers: 0, linked: 0, createdPapers: 0, backfilled: 0
  };
  // The daily run between two upstream publishes ends here, after two reads.
  if (isNoop(plan)) return result;

  for (const r of plan.upserts) {
    const data = { name: r.name, affiliation: r.affiliation, knownFor: r.knownFor, active: true };
    await prisma.researcher.upsert({ where: { slug: r.slug }, create: { slug: r.slug, ...data }, update: data });
  }
  if (plan.deactivate.length) {
    await prisma.researcher.updateMany({ where: { slug: { in: plan.deactivate } }, data: { active: false } });
  }
  if (plan.newLinks.length) {
    const papers = [...new Map(plan.newLinks.map((l) => [l.paper.arxivId, l.paper])).values()];
    const linkedBefore = new Set(links.map((l) => l.paper.arxivId));
    result.newPapers = papers.filter((p) => !linkedBefore.has(p.arxivId)).length;
    const ensured = await ensurePapers(papers);
    result.createdPapers = ensured.created;
    result.backfilled = ensured.backfilled;
    const { count } = await prisma.researcherPaper.createMany({
      data: plan.newLinks.flatMap((l) => {
        const paperId = ensured.byArxiv.get(l.paper.arxivId);
        return paperId ? [{ researcherSlug: l.slug, paperId, position: l.paper.position }] : [];
      }),
      skipDuplicates: true
    });
    result.linked = count;
  }
  for (const m of plan.moved) {
    await prisma.researcherPaper.update({
      where: { researcherSlug_paperId: { researcherSlug: m.slug, paperId: m.paperId } },
      data: { position: m.position }
    });
  }
  return result;
}

/**
 * Resolve papers by arXiv id: backfill rows that exist, create the rest with
 * exactly the fields a digest-created arXiv row has (daily-digest.ts). No
 * pdfUrl or externalUrl: the preview derives the PDF and the arXiv link from
 * arxivId, and an abs-page externalUrl would repeat that link as "source".
 */
async function ensurePapers(papers: FeedPaper[]) {
  const ids = papers.map((p) => p.arxivId);
  const existing = await prisma.paper.findMany({
    where: { arxivId: { in: ids } },
    select: { id: true, arxivId: true, abstract: true, publishedAt: true }
  });
  const patches = backfillPatches(papers, existing);
  for (const [id, data] of patches) {
    await prisma.paper.update({ where: { id }, data });
  }
  const known = new Set(existing.map((p) => p.arxivId));
  const missing = papers.filter((p) => !known.has(p.arxivId));
  let created = 0;
  if (missing.length) {
    const { count } = await prisma.paper.createMany({
      data: missing.map((p) => ({
        title: p.title, abstract: p.abstract || null, authors: p.authors,
        source: "arxiv", sourceId: p.arxivId, arxivId: p.arxivId, publishedAt: fromIsoDay(p.published)
      })),
      skipDuplicates: true
    });
    created = count;
  }
  const rows = missing.length
    ? await prisma.paper.findMany({ where: { arxivId: { in: ids } }, select: { id: true, arxivId: true } })
    : existing;
  return { byArxiv: new Map(rows.map((p) => [p.arxivId!, p.id])), created, backfilled: patches.size };
}

// ---------------------------------------------------------- classification

const CLASSIFY_BATCH = 20;
/** One batch call; also the margin kept before the run's deadline. */
const CLASSIFY_CALL_MS = 120_000;

/**
 * Every paper of the batch gets a direction: an id the model skipped or
 * answered with an unknown direction becomes "other" rather than staying
 * pending, where it would hold the month's issue back on every run. An answer
 * with no list at all throws, so the batch is retried on the next run instead.
 */
export function parseAssignments(raw: unknown, batchIds: readonly string[]): Map<string, string> {
  const list = (raw as { assignments?: unknown } | null)?.assignments;
  if (!Array.isArray(list)) {
    throw new SyntaxError("classification answer has no assignments list");
  }
  const answered = new Map<string, string>();
  for (const item of list) {
    const { id, direction } = (item ?? {}) as { id?: unknown; direction?: unknown };
    if (typeof id === "string" && typeof direction === "string" && DIRECTION_IDS.has(direction)) {
      answered.set(id, direction);
    }
  }
  return new Map(batchIds.map((id) => [id, answered.get(id) ?? OTHER_DIRECTION_ID]));
}

export type ClassifyResult = { classified: number; remaining: number };

/**
 * Classify the window's papers that have no direction in this workspace yet,
 * with the workspace's own LLM (DB config first, env as the fallback, like
 * every LLM call). Papers outside the window are never classified: they are
 * never shown or summarised. A failed call throws; the batches before it are
 * already stored, and the next run picks up the rest.
 *
 * Safe to overlap with another run for the same workspace (the cron and the
 * admin button): (workspaceId, paperId) is PaperDirection's key and
 * skipDuplicates drops the rows the other run wrote first. `remaining` counts
 * papers this run has not handled, not rows it wrote, so a paper the other run
 * classified does not hold the month's issue back.
 */
export async function classifyPendingPapers(workspaceId: string, now: Date, deadline: number): Promise<ClassifyResult> {
  const pending = await prisma.paper.findMany({
    where: {
      researcherPapers: { some: { researcher: { active: true } } },
      directions: { none: { workspaceId } },
      publishedAt: { gte: windowStart(now) }
    },
    select: { id: true, arxivId: true, title: true, abstract: true },
    orderBy: { publishedAt: "desc" }
  });
  if (!pending.length) return { classified: 0, remaining: 0 };

  const config = await resolveLlmConfig(workspaceId);
  let classified = 0;
  let handled = 0;
  for (let i = 0; i < pending.length; i += CLASSIFY_BATCH) {
    // Never start a call the function could be killed in the middle of.
    if (Date.now() + CLASSIFY_CALL_MS > deadline) break;
    const batch = pending.slice(i, i + CLASSIFY_BATCH).map((p) => ({ ...p, key: p.arxivId ?? p.id }));
    const answer = await completeJson<unknown>(
      config,
      directionPrompt(batch.map((p) => ({ id: p.key, title: p.title, abstract: p.abstract ?? "" }))),
      { maxTokens: 4000, timeoutMs: CLASSIFY_CALL_MS }
    );
    const assignments = parseAssignments(answer, batch.map((p) => p.key));
    const { count } = await prisma.paperDirection.createMany({
      data: batch.map((p) => ({ workspaceId, paperId: p.id, directionId: assignments.get(p.key)! })),
      skipDuplicates: true
    });
    classified += count;
    handled += batch.length;
  }
  return { classified, remaining: pending.length - handled };
}
