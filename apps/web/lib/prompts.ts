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
 * An issue the team approved (September 2026), carried as the prompt's
 * example. It is data, not instructions, which is why it is the one Chinese
 * text in this file.
 */
export const DIGEST_EXAMPLE = {
  headline: "推理服务仍是重心，agent 正在改变它要服务的对象",
  lede: "11 位研究者这 3 个月发了 41 篇论文，做的人最多的是[[llm-serving|LLM 推理服务]]（7 位）。agent 出现在其中 9 位的论文里：有人按 agent 的负载重新设计推理系统，有人[[agents-for-systems|让 agent 写 kernel、造操作系统]]。",
  observations: [
    { claim: "推理系统开始按 agent 的样子重新设计。", evidence: "TraceLab 刻画 coding agent 的真实负载，SMetric 按会话调度，前缀缓存的淘汰策略也在重新评估。",
      directions: ["llm-serving"], papers: ["2606.30560", "2607.08565", "2609.28870"] },
    { claim: "显存不够，推理在向外借内存。", evidence: "KV cache 分层放到主存（HiSparse、BOOST），跨卡借显存（EMA），或者直接压缩（MosaicKV）。",
      directions: ["llm-serving", "gpu-cluster"], papers: ["2608.07009", "2609.13592", "2609.27040", "2607.00760"] },
    { claim: "验证成了 agent 做系统工作的瓶颈。", evidence: "7 篇论文在造评测或验证工具，例如 CommBench、PerfReasoning、LLM-as-a-Verifier。",
      directions: ["agents-for-systems", "agent-harness"], papers: ["2608.04450", "2609.04476", "2607.05391"] },
    { claim: "解耦推理越拆越细。", evidence: "从实例级的 prefill/decode 分离，拆到算子级（OpWeave）和专家级（ExpertPlex）。",
      directions: ["moe-disaggregation"], papers: ["2609.14237", "2607.18002"] },
    { claim: "早期信号：RL 后训练的系统开销。", evidence: "WeightBridge 处理训练端到 rollout 端的权重同步，另一篇研究异步 RLHF 中样本陈旧度的影响。",
      directions: ["gpu-cluster"], papers: ["2609.25442", "2607.01083"] }
  ]
};

/**
 * The monthly hot-topics issue of the Researchers page. The input carries
 * every figure the text may cite (computed by code) and names papers by arXiv
 * id; `previousErrors` hands a failed answer's validation errors back for the
 * one retry.
 */
export function researcherDigestPrompt(
  input: DigestInput,
  language: OutputLanguage,
  previousErrors: string[] = []
): Prompt {
  const profile = LANGUAGE_PROFILES[language];
  const limits = DIGEST_LIMITS[language];
  const atMost = (n: number) => `at most ${n} ${limits.unit}`;
  const system = `You are the editor of a monthly digest about LLM and AI systems research. Write in ${profile.name}. Return pure JSON.

The input lists the papers a fixed set of researchers posted to arXiv in the window. Each paper has an arXiv id and one research direction; "stats", "directions" and "families" hold figures computed by code. Write like a magazine editor's note: judgements about what is changing, each backed by papers.

JSON shape: {"headline": string, "lede": string, "observations": [{"claim": string, "evidence": string, "directions": [direction ids], "papers": [arXiv ids]}]}

Structure and length:
- headline: one judgement naming this period's main thread, ${atMost(limits.headline)}.
- lede: at most 2 sentences and ${atMost(limits.lede)}. Set the scene with concrete examples, not abstract taxonomies such as "three roles".
- observations: 4 or 5. "claim" is one judgement (what is changing and why it matters), ${atMost(limits.claim)}. "evidence" is ONE sentence, ${atMost(limits.evidence)}, naming papers by their short titles; avoid person names.
- Directions backed by only two or three papers are not a trend yet: merge them into one final observation about early signals instead of giving each its own.

Evidence:
- Each observation cites at least 2 arXiv ids from the input in "papers", and its "directions" lists the direction of every paper it cites.
- If only one group works on something, you may write about it but must say so plainly.
- Judge from titles and abstracts only: do not guess motives or grade papers.

Numbers: use only numbers found in "stats", "directions" or "families" (a family groups related directions, such as both agent directions), and the window's ${WINDOW_MONTHS} months. Never count anything yourself.

Marking: write a direction's name, or a phrase standing for it, as [[direction-id|text]]; the page tints it. No links, no Markdown.

Never:
- write who did NOT work on something, or any negative comparison;
- rank, praise or profile individual researchers; refer to researchers by name only, with no honorifics;
- use hype words (revolutionary, groundbreaking, disruptive) or meta phrases ("this issue will", "it is worth noting", "in summary");
- use dash asides.

Style rules for ${profile.name}:
${profile.styleRules}

An approved issue from an earlier month, as an example of structure, register and length (its numbers and papers are not this month's):
${JSON.stringify(DIGEST_EXAMPLE)}`;
  const fix = previousErrors.length
    ? `\n\nYour previous answer failed these checks. Fix every one and answer again in full:\n- ${previousErrors.join("\n- ")}`
    : "";
  return { system, user: JSON.stringify(input) + fix };
}
