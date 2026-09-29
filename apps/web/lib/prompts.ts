import type { OutputLanguage } from "@paper-viewer/core/llm-config";
import type { ArxivPaper } from "./arxiv";
import type { PaperAnalysisResult } from "./llm";
import type { DigestInput } from "./researcher-digest";
import { DIGEST_LIMITS, DIRECTIONS, OTHER_DIRECTION_ID, WINDOW_MONTHS } from "./researchers";

/**
 * The generation prompts for paper intros, the daily overview, and the
 * Researchers page (direction classification and the monthly issue).
 *
 * Every prompt is written in English regardless of the language it asks for.
 * Instruction following is strongest in English, and a prompt written in the
 * target language is redundant with the instruction that names it; keeping one
 * language here also means adding a third output language is a table entry
 * rather than a second prose rewrite.
 *
 * `keywords` stay English in every language on purpose — they become the topic
 * tags the whole workspace filters by, and a bilingual team splitting into two
 * tag vocabularies would fragment the library. See OutputLanguage in
 * @paper-viewer/core/llm-config.
 */
export type Prompt = { system: string; user: string };

type LanguageProfile = {
  /** How the prompt names the language to the model. */
  name: string;
  /**
   * Per-paper length budget for the daily briefing, in the unit natural to the
   * script (characters for Chinese, words for English). The briefing's target
   * length scales with how many papers it covers — a fixed target made a
   * 10-paper day read as thin as a 3-paper day.
   */
  overviewPerPaper: { min: number; max: number; unit: string };
  /** Writing conventions that only apply to this language. */
  styleRules: string;
};

/**
 * The Chinese rules exist because of one specific failure the user rejected:
 * glossing every term with its translation in parentheses. It reads like machine
 * translation and makes the same concept appear twice in one sentence. Which
 * terms stay English is left to the model, based on what is customary in the field.
 */
const LANGUAGE_PROFILES: Record<OutputLanguage, LanguageProfile> = {
  zh: {
    name: "Simplified Chinese",
    overviewPerPaper: { min: 150, max: 200, unit: "characters" },
    styleRules: `- Write each term in one language only. Never pair a term with its translation in parentheses, in either direction — no "English term (Chinese term)" and no "Chinese term (English term)".
- Decide per term: leave it in English when researchers in the field say it in English day to day (transformer, KV cache, test-time scaling, reflection, agent); write it in Chinese when a standard Chinese term exists and loses nothing in translation (latency, energy, throughput, datacenter, accuracy).
- Do not expand an obscure abbreviation in parentheses; pick one language for its full form and use that.`
  },
  en: {
    name: "English",
    overviewPerPaper: { min: 80, max: 120, unit: "words" },
    styleRules: `- Use a term's established name; do not invent expansions for well-known abbreviations.
- Explain an unfamiliar term the first time it appears, in one clause, rather than in a parenthetical gloss every time.
- Prefer plain words over the paper's own phrasing: write for a researcher in a neighbouring area, not for the authors.`
  }
};

/**
 * What the model is given to work from. An arXiv paper arrives with an
 * abstract; a conference catalog entry never does — the feed carries titles and
 * authors only — so those are analysed from the PDF's extracted text instead.
 * A paper with neither is not analysed at all: see processPaper.
 */
export type SourceMaterial =
  | { kind: "abstract"; text: string }
  | { kind: "fullText"; text: string };

/**
 * Full text is sent truncated. It is only ever the fallback for a paper with no
 * abstract, and the front of a paper carries what the analysis asks about;
 * sending an entire 40-page PDF would cost far more than the answer improves.
 */
const FULL_TEXT_LIMIT = 40_000;

export function analysisPrompt(
  language: OutputLanguage,
  paper: ArxivPaper,
  topics: string[],
  source: SourceMaterial = { kind: "abstract", text: paper.abstract }
): Prompt {
  const profile = LANGUAGE_PROFILES[language];
  const sourceBlock =
    source.kind === "abstract"
      ? `Abstract: ${source.text}`
      : `Full text of the paper (truncated), which is all there is — this paper has no abstract on file:
${source.text.slice(0, FULL_TEXT_LIMIT)}`;

  return {
    system: `You are a computer-systems research assistant who analyses papers on systems for large models. Write every analysis in ${profile.name}, in plain language, explaining technical concepts clearly. Return pure JSON.

Style rules for ${profile.name}:
${profile.styleRules}`,
    user: `Analyse this paper in detail and summarise it in plain ${profile.name}.

Title: ${paper.title}
arXiv: ${paper.arxivId}
Authors: ${paper.authors.join(", ")}
${sourceBlock}

The reader's research areas: ${topics.join(", ")}

Cover all five angles below. Each one needs real content — a single sentence is not enough.

Return JSON:
{
  "title": "${paper.title}",
  "arxivId": "${paper.arxivId}",
  "motivation": "1. Motivation: why was this work done? What hurts about existing systems or methods? Explain the background in plain language (${profile.name}, 3-4 sentences)",
  "problem": "2. Core problem: which technical problem does it actually solve? State it clearly, without abbreviations (${profile.name}, 2-3 sentences)",
  "method": "3. Method: what does it propose? What is the core idea, and which design decisions matter? Explain it plainly rather than repeating the paper's terminology (${profile.name}, 4-5 sentences)",
  "keyFindings": "4. Results: how much better than prior work, and measured how? Give concrete numbers and comparisons (${profile.name}, 3-4 sentences)",
  "whyItMatters": "5. Room to improve: what are the limitations? What could be pushed further, and what does this suggest for follow-up work? (${profile.name}, 2-3 sentences)",
  "summary": "One paragraph on the paper's core contribution (${profile.name}, 2-3 sentences)",
  "keywords": ["english keyword1", "english keyword2", "english keyword3"],
  "relevanceScore": 0.9
}

Notes:
- Write the analysis the way you would explain the paper to a colleague, in ${profile.name}
${profile.styleRules}
- keywords are always English, lowercase, 1-4 words each, whatever the analysis language
- relevanceScore rates relevance to the reader's research areas, 0-1`
  };
}

/**
 * Whether a briefing is whole enough to show a reader.
 *
 * Providers can hand back a fragment inside syntactically valid JSON — on
 * 2026-08-27 kimi answered a ten-paper briefing with ~150 characters ending
 * mid-sentence, and it passed every check on the way to the page. Parsing
 * proves the envelope; this proves the letter.
 *
 * Two checks, both against the same spec overviewPrompt asks for:
 * - at least half the minimum length for this many papers (characters for
 *   Chinese, words for English) — half, so normal shortfall never trips it;
 * - a sentence-ending stop at the end, looking through closing markdown and
 *   quotes, because generation that dies mid-thought ends on a bare word.
 *
 * Used both when accepting a fresh generation and when deciding whether a
 * stored overview deserves a rewrite, so one judgement covers both moments.
 */
export function isCompleteOverview(
  overview: string,
  paperCount: number,
  language: OutputLanguage
): boolean {
  const { min, unit } = LANGUAGE_PROFILES[language].overviewPerPaper;
  const floor = (min * Math.max(1, paperCount)) / 2;
  const length =
    unit === "characters" ? overview.length : overview.split(/\s+/).filter(Boolean).length;
  if (length < floor) {
    return false;
  }

  const trimmed = overview.replace(/[\s*_`~"'”」』)\]）】]+$/u, "");
  return /[。！？.!?…]$/u.test(trimmed);
}

export function overviewPrompt(
  language: OutputLanguage,
  analyses: PaperAnalysisResult[],
  topics: string[]
): Prompt {
  const profile = LANGUAGE_PROFILES[language];
  const paperSummaries = analyses
    .map(
      (a, i) =>
        `${i + 1}. ${a.title}\n   - Motivation: ${a.motivation}\n   - Method: ${a.method}\n   - Results: ${a.keyFindings}`
    )
    .join("\n\n");
  const { min, max, unit } = profile.overviewPerPaper;
  const lengthSpec = `${min * analyses.length}-${max * analyses.length} ${unit}`;

  return {
    system: `You analyse research trends in systems for large models. Write in ${profile.name}, in plain language. Return pure JSON.

Style rules for ${profile.name}:
${profile.styleRules}`,
    user: `Write a briefing over today's ${analyses.length} recommended papers, in ${profile.name}.

The reader's research areas: ${topics.join(", ")}

Today's papers:
${paperSummaries}

Structure the briefing as Markdown, as four sections in this order (section headings in ${profile.name}):
1. An opening line on the most notable direction today — no heading, one or two sentences
2. Technical trends: 2-3 numbered observations, each grounded in the papers that show it
3. How the papers relate: which ones tackle similar problems, named by number and title
4. Close reading: the 2-3 papers worth reading closely today and why

Requirements:
- Every paper gets mentioned at least once — a reader uses this briefing to decide which of the ${analyses.length} to open, so none may be silently skipped
- Never compress the briefing into one paragraph; the sections and their lists are the format
- Write in plain ${profile.name}, following the style rules:
${profile.styleRules}

Return JSON — overviewSummary must be a single string containing the whole Markdown briefing:
{
  "overviewSummary": "the full briefing (${profile.name}, ${lengthSpec} — the target scales with the number of papers, so cover them at that depth rather than compressing)"
}`
  };
}

/** Abstract budget per paper in a classification batch. */
const CLASSIFY_ABSTRACT_CHARS = 800;

/**
 * Sorting researcher papers into the fixed directions (lib/researchers.ts).
 * Papers are named by arXiv id, and the answer must cover every one.
 */
export function directionPrompt(papers: { id: string; title: string; abstract: string }[]): Prompt {
  const list = DIRECTIONS.map((d) => `- ${d.id} (${d.labelEn}): ${d.definition}`).join("\n");
  return {
    system: `You sort systems research papers into a fixed list of research directions. Return pure JSON.

Directions:
${list}

Rules:
- Pick exactly one direction id per paper, from the list above only.
- Judge by what the paper builds or studies, not by words it mentions in passing.
- A benchmark or verifier for agents that do systems work belongs to "agents-for-systems".
- Use "${OTHER_DIRECTION_ID}" only when no direction fits.
- Answer for every paper id you are given, exactly once.

Return JSON: {"assignments": [{"id": "<arXiv id>", "direction": "<direction id>"}]}`,
    user: JSON.stringify(
      papers.map((p) => ({ id: p.id, title: p.title, abstract: p.abstract.slice(0, CLASSIFY_ABSTRACT_CHARS) }))
    )
  };
}

/**
 * An illustrative issue on a topic the tracked researchers do not work on,
 * carried as the prompt's example. It teaches form, not content: an example
 * drawn from the real papers was copied nearly word for word. It is data, not
 * instructions, which is why it is the one Chinese text in this file.
 */
export const DIGEST_EXAMPLE = {
  headline: "存储栈开始为训练数据重新设计",
  lede: "训练数据从静态文件变成持续增长的数据流，读取也从顺序扫描变成大规模随机访问。[[gpu-cluster|集群底层]]的存储与缓存假设因此都要重新检验。",
  themes: [
    { title: "数据加载成为训练瓶颈", insight: "GPU 越来越快，预处理和随机读取却跟不上，训练任务开始按数据管道而不是按算力来规划。",
      papers: ["2401.00001", "2401.00002", "2401.00003"] },
    { title: "检查点走向增量写入", insight: "模型变大后完整写一次检查点要几分钟，只写变化部分的增量检查点正在成为默认做法。",
      papers: ["2401.00004", "2401.00005"] },
    { title: "缓存从单机走向集群共享", insight: "同一份数据被许多任务反复读取，单机缓存命中率太低，集群级共享缓存开始取代各自为政。",
      papers: ["2401.00006", "2401.00007"] }
  ],
  surprise: { text: "一项测量发现，训练任务的大部分读取其实都落在一小部分热数据上。", paper: "2401.00008" }
};

/**
 * The monthly hot-topics issue of the Researchers page: where the tracked
 * researchers' attention converges, not a tour of the directions. The input
 * carries every figure the text may cite (computed by code) and names papers
 * by arXiv id; `previousErrors` hands a failed answer's validation errors
 * back for the one retry.
 */
export function researcherDigestPrompt(
  input: DigestInput,
  language: OutputLanguage,
  previousErrors: string[] = []
): Prompt {
  const profile = LANGUAGE_PROFILES[language];
  const limits = DIGEST_LIMITS[language];
  const atMost = (n: number) => `at most ${n} ${limits.unit}`;
  const system = `You write a monthly note for a reader who follows a fixed set of leading systems researchers to see where their attention is converging. Write in ${profile.name}. Return pure JSON.

The reader's question is: what are these researchers converging on right now, and what new problems do they see? A trend is several different researchers independently attacking the same problem, often across the input's fixed directions (one shift in workloads can touch serving, caching and scheduling at once). A summary of each direction in turn does not answer it.

The input lists the papers these researchers posted to arXiv in the window, each with its arXiv id, one research direction and its tracked researchers; "stats", "directions" and "families" hold figures computed by code.

JSON shape: {"headline": string, "lede": string, "themes": [{"title": string, "insight": string, "papers": [arXiv ids]}], "surprise": {"text": string, "paper": arXiv id} | null}

- headline: the strongest convergence, as a judgement, ${atMost(limits.headline)}.
- lede: at most 2 sentences and ${atMost(limits.lede)}: what changed that makes these problems appear now.
- themes: 3 or 4, each a problem that papers from at least 2 different researchers attack. The page shows how many researchers each theme spans, so prefer themes that span more, and never write that count yourself.
  - title: the shared problem, as a judgement, ${atMost(limits.title)}.
  - insight: ONE sentence, ${atMost(limits.insight)}, on why this is a problem now or what the papers together imply. Do not list paper names; name at most one paper, by its short title, when a single result carries the point.
  - papers: every input paper that attacks this problem, by its arXiv id in the input (never an id from the example below).
- surprise: one result stated in an abstract that goes against common expectation, such as a sophisticated method doing no better than a simple one, in ONE sentence of ${atMost(limits.insight)}, with its paper's arXiv id; null when no abstract states such a result.

Evidence and numbers: judge from titles and abstracts only; do not guess motives or grade papers. Use only numbers found in "stats", "directions" or "families" and the window's ${WINDOW_MONTHS} months; never count anything yourself, and do not repeat figures from abstracts.

Marking: write a direction's name, or a phrase standing for it, as [[direction-id|text]]; the page tints it. No links, no Markdown.

Never:
- name researchers, or rank, praise or profile them;
- write who did NOT work on something, or any negative comparison;
- use hype words (revolutionary, groundbreaking, disruptive) or meta phrases ("this issue will", "it is worth noting", "in summary");
- use dash asides.

Style rules for ${profile.name}:
${profile.styleRules}

An illustrative issue on another topic, for structure, register and length only. Do not reuse its themes, wording or ids:
${JSON.stringify(DIGEST_EXAMPLE)}`;
  const fix = previousErrors.length
    ? `\n\nYour previous answer failed these checks. Fix every one and answer again in full:\n- ${previousErrors.join("\n- ")}`
    : "";
  return { system, user: JSON.stringify(input) + fix };
}
