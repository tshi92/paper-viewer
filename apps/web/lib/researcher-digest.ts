import { prisma } from "@paper-viewer/db";
import { toOutputLanguage, type OutputLanguage } from "@paper-viewer/core/llm-config";
import { isUniqueViolation } from "@/lib/daily-digest";
import { completeJson } from "@/lib/llm";
import { resolveLlmConfig } from "@/lib/llm-config";
import { researcherDigestPrompt } from "@/lib/prompts";
import {
  DIGEST_LIMITS, DIRECTIONS, DIRECTION_IDS, OTHER_DIRECTION_ID, WINDOW_MONTHS,
  directionLabel, isoDay, monthKey, tally, utcDay, windowStart
} from "@/lib/researchers";

/**
 * The monthly "hot topics" issue of the Researchers page, per workspace.
 * Code counts, the model writes, code checks: every number the text may cite
 * is computed here, the answer is validated, and one failed answer is retried
 * with its errors attached.
 *
 * Sealed by creation: a ResearcherDigest row exists only for a validated
 * issue and is never rewritten. (workspaceId, month) is unique, so of two
 * overlapping runs (the daily cron and the admin sync button) the second gets
 * P2002 — "already sealed". A failed month leaves no row; the page shows the
 * latest issue under its own month and the next run tries again.
 */

// ----------------------------------------------------------- window papers

/** A paper in the window with its tracked authors and its direction in one workspace; shared with the page. */
export type WindowPaper = {
  id: string;
  arxivId: string;
  title: string;
  abstract: string;
  authors: string[];
  /** YYYY-MM-DD */
  published: string;
  directionId: string;
  researchers: { slug: string; name: string; position: number }[];
};

/**
 * Active researchers' papers of the last 91 days, newest first, each with its
 * direction in `workspaceId` (a paper not yet classified there reads as other).
 */
export async function loadWindowPapers(workspaceId: string, now: Date): Promise<WindowPaper[]> {
  const links = await prisma.researcherPaper.findMany({
    where: { researcher: { active: true }, paper: { publishedAt: { gte: windowStart(now) } } },
    select: {
      position: true,
      researcher: { select: { slug: true, name: true } },
      paper: {
        select: {
          id: true, arxivId: true, title: true, abstract: true, authors: true, publishedAt: true,
          // At most one row: (workspaceId, paperId) is the key.
          directions: { where: { workspaceId }, select: { directionId: true } }
        }
      }
    }
  });
  const byPaper = new Map<string, WindowPaper>();
  for (const { position, researcher, paper } of links) {
    const entry = byPaper.get(paper.id) ?? {
      id: paper.id,
      arxivId: paper.arxivId ?? "",
      title: paper.title,
      abstract: paper.abstract ?? "",
      authors: Array.isArray(paper.authors) ? paper.authors.map(String) : [],
      // Non-null: the window filter excludes null dates, and the sync backfills them.
      published: isoDay(paper.publishedAt!),
      directionId: paper.directions[0]?.directionId ?? OTHER_DIRECTION_ID,
      researchers: []
    };
    entry.researchers.push({ slug: researcher.slug, name: researcher.name, position });
    byPaper.set(paper.id, entry);
  }
  return [...byPaper.values()].sort((a, b) => b.published.localeCompare(a.published));
}

// ------------------------------------------------------------------- input

export type DigestPaper = {
  /** arXiv id: short, and what the model cites in "papers". */
  id: string;
  title: string;
  abstract: string;
  direction: string;
  date: string;
  researchers: { name: string; role: string }[];
};

export type DigestInput = {
  window: { from: string; to: string };
  stats: { papers: number; researchers: number };
  directions: { id: string; label: string; papers: number; people: number }[];
  families: { family: string; directions: string[]; papers: number; people: number }[];
  papers: DigestPaper[];
};

const DIGEST_ABSTRACT_CHARS = 600;

const roleOf = (position: number, count: number): string =>
  position === count ? "last author" : position === 1 ? "first author" : `${position} of ${count}`;

/**
 * Everything the model may cite. Per-researcher figures are deliberately
 * absent: the issue must not rank or profile people.
 */
export function buildDigestInput(args: {
  papers: WindowPaper[];
  researcherCount: number;
  language: OutputLanguage;
  window: { from: string; to: string };
}): DigestInput {
  const directions = DIRECTIONS.map((d) => ({
    id: d.id,
    label: directionLabel(d, args.language),
    ...tally(args.papers.filter((p) => p.directionId === d.id))
  })).filter((d) => d.papers > 0);
  const families = [...new Set(DIRECTIONS.map((d) => d.family))].flatMap((family) => {
    const ids = DIRECTIONS.filter((d) => d.family === family).map((d) => d.id);
    // A one-direction family would only repeat that direction's figures.
    if (ids.length < 2) return [];
    return [{ family, directions: ids, ...tally(args.papers.filter((p) => ids.includes(p.directionId))) }];
  });
  return {
    window: args.window,
    stats: { papers: args.papers.length, researchers: args.researcherCount },
    directions,
    families,
    papers: args.papers.map((p) => ({
      id: p.arxivId,
      title: p.title,
      abstract: p.abstract.slice(0, DIGEST_ABSTRACT_CHARS),
      direction: p.directionId,
      date: p.published,
      researchers: p.researchers.map((r) => ({ name: r.name, role: roleOf(r.position, p.authors.length) }))
    }))
  };
}

// ------------------------------------------------------ highlights, length

export type HighlightPart = { text: string; directionId?: string };
const HIGHLIGHT = /\[\[([a-z0-9-]+)\|([^\]]+)\]\]/g;

/** Direction highlights written by the model as [[directionId|text]]. */
export function splitHighlights(text: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let last = 0;
  for (const match of text.matchAll(HIGHLIGHT)) {
    if (match.index! > last) parts.push({ text: text.slice(last, match.index) });
    parts.push({ text: match[2]!, directionId: match[1]! });
    last = match.index! + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

const plain = (text: string): string => splitHighlights(text).map((part) => part.text).join("");

/** One unit per CJK character or Latin word (see DIGEST_LIMITS). */
export function textLength(text: string): number {
  return (plain(text).match(/[㐀-鿿豈-﫿]|[A-Za-z0-9][A-Za-z0-9.+-]*/g) ?? []).length;
}

const sentenceCount = (text: string): number => (plain(text).match(/[。！？]|[.!?](?=\s|$)/g) ?? []).length;

// -------------------------------------------------------------- validation

export type DigestObservation = { claim: string; evidence: string; directions: string[]; papers: string[] };
export type DigestText = { headline: string; lede: string; observations: DigestObservation[] };
/** What ResearcherDigest.content stores: the text plus the figures it was written from. */
export type DigestContent = DigestText & { window: DigestInput["window"]; stats: DigestInput["stats"] };

const COUNTED = /(\d+)\s*(?:篇|位|人|个|%|papers?\b|researchers?\b|people\b)/g;
const BANNED = [
  /只有.{0,40}(没|未)/, /完全没/, /大佬/, /颠覆|革命性|重磅|划时代/, /——/, /本文将|值得注意的是|总的来说/,
  /\bnobody\b/i, /\bonly\b.{0,60}\b(did not|didn't|never)\b/i, /revolutionary|groundbreaking|game-chang|disruptive/i,
  /\bthis (issue|article) will\b|\bit is worth noting\b|\bin summary\b/i
];

function allowedNumbers(input: DigestInput): Set<number> {
  return new Set([
    input.stats.papers, input.stats.researchers, WINDOW_MONTHS,
    ...input.directions.flatMap((d) => [d.papers, d.people]),
    ...input.families.flatMap((f) => [f.papers, f.people])
  ]);
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export function validateDigest(
  raw: unknown,
  input: DigestInput,
  language: OutputLanguage
): { content: DigestText | null; errors: string[] } {
  const limits = DIGEST_LIMITS[language];
  const errors: string[] = [];
  const need = (ok: boolean, message: string) => {
    if (!ok) errors.push(message);
  };
  const fits = (text: unknown, max: number): boolean =>
    typeof text === "string" && textLength(text) >= 1 && textLength(text) <= max;
  const r = (raw ?? {}) as { headline?: unknown; lede?: unknown; observations?: unknown };
  const directionOf = new Map(input.papers.map((p) => [p.id, p.direction]));
  const numbers = allowedNumbers(input);
  const texts: string[] = [];

  need(fits(r.headline, limits.headline), `headline must be 1-${limits.headline} ${limits.unit}`);
  need(fits(r.lede, limits.lede), `lede must be 1-${limits.lede} ${limits.unit}`);
  need(typeof r.lede !== "string" || sentenceCount(r.lede) <= 2, "lede must be at most 2 sentences");
  for (const text of [r.headline, r.lede]) if (typeof text === "string") texts.push(text);

  const observations = (Array.isArray(r.observations) ? r.observations : []) as Record<string, unknown>[];
  need(observations.length >= 4 && observations.length <= 5, "observations must have 4-5 items");
  observations.forEach((o, index) => {
    const at = `observation ${index + 1}`;
    need(fits(o?.claim, limits.claim), `${at}: claim must be 1-${limits.claim} ${limits.unit}`);
    need(fits(o?.evidence, limits.evidence), `${at}: evidence must be 1-${limits.evidence} ${limits.unit}`);
    need(typeof o?.evidence !== "string" || sentenceCount(o.evidence) <= 1, `${at}: evidence must be one sentence`);
    const declared = strings(o?.directions);
    need(declared.length > 0, `${at}: "directions" is empty`);
    for (const id of declared) need(DIRECTION_IDS.has(id), `${at}: unknown direction ${id}`);
    const cited = [...new Set(strings(o?.papers))];
    need(cited.length >= 2, `${at}: cite at least 2 papers`);
    for (const id of cited) {
      const direction = directionOf.get(id);
      if (direction === undefined) need(false, `${at}: paper ${id} is not in the window`);
      else need(declared.includes(direction), `${at}: paper ${id} is ${direction}, which "directions" does not list`);
    }
    for (const text of [o?.claim, o?.evidence]) if (typeof text === "string") texts.push(text);
  });

  for (const text of texts) {
    for (const part of splitHighlights(text)) {
      if (part.directionId) need(DIRECTION_IDS.has(part.directionId), `unknown direction in highlight: ${part.directionId}`);
    }
    for (const match of plain(text).matchAll(COUNTED)) {
      need(numbers.has(Number(match[1])), `number ${match[1]} is not in the provided statistics`);
    }
    for (const pattern of BANNED) need(!pattern.test(text), `banned phrasing matched /${pattern.source}/`);
  }

  if (errors.length) return { content: null, errors };
  return {
    content: {
      headline: r.headline as string,
      lede: r.lede as string,
      observations: observations.map((o) => ({
        claim: o.claim as string,
        evidence: o.evidence as string,
        directions: strings(o.directions),
        papers: strings(o.papers)
      }))
    },
    errors
  };
}

// -------------------------------------------------------------- generation

/** Per attempt; the same ceiling as the daily briefing (llm.ts OVERVIEW_TIMEOUT_MS). */
const ATTEMPT_MS = 180_000;

export type IssueResult = {
  status: "exists" | "sealed" | "no_papers" | "deferred" | "failed";
  errors?: string[];
};

/** Write this month's issue for one workspace unless it is already sealed. */
export async function ensureMonthlyIssue(workspaceId: string, now: Date, deadline: number): Promise<IssueResult> {
  const month = monthKey(now);
  const sealed = await prisma.researcherDigest.findUnique({
    where: { workspaceId_month: { workspaceId, month } },
    select: { id: true }
  });
  if (sealed) return { status: "exists" };

  const [papers, researcherCount, prefs] = await Promise.all([
    loadWindowPapers(workspaceId, now),
    prisma.researcher.count({ where: { active: true } }),
    prisma.researchPreferences.findUnique({ where: { workspaceId }, select: { outputLanguage: true } })
  ]);
  if (papers.length === 0) return { status: "no_papers" };
  const language = toOutputLanguage(prefs?.outputLanguage);
  const input = buildDigestInput({
    papers, researcherCount, language,
    window: { from: isoDay(windowStart(now)), to: isoDay(utcDay(now)) }
  });
  const config = await resolveLlmConfig(workspaceId);

  let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Never start a call the function could be killed in the middle of
    // (maxDuration 300s); the next run starts over.
    if (Date.now() + ATTEMPT_MS > deadline) return { status: "deferred", errors };
    let answer: unknown;
    try {
      answer = await completeJson<unknown>(config, researcherDigestPrompt(input, language, errors), {
        maxTokens: 8000,
        timeoutMs: ATTEMPT_MS
      });
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      errors = ["the answer was not valid JSON"];
      continue;
    }
    const verdict = validateDigest(answer, input, language);
    if (verdict.content) {
      const content: DigestContent = { ...verdict.content, window: input.window, stats: input.stats };
      try {
        await prisma.researcherDigest.create({ data: { workspaceId, month, content } });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        return { status: "exists" };
      }
      return { status: "sealed" };
    }
    errors = verdict.errors;
  }
  console.error("[researcher-digest] failed validation twice", workspaceId, errors);
  return { status: "failed", errors };
}
