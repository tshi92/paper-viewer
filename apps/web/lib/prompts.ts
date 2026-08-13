import type { OutputLanguage } from "@paper-viewer/core/llm-config";
import type { ArxivPaper } from "./arxiv";
import type { PaperAnalysisResult } from "./llm";

/**
 * The generation prompts for paper intros and the daily overview.
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
  /** Length guidance for the daily briefing, whose natural size differs per script. */
  overviewLength: string;
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
    overviewLength: "400-600 characters",
    styleRules: `- Write each term in one language only. Never pair a term with its translation in parentheses, in either direction — no "English term (Chinese term)" and no "Chinese term (English term)".
- Decide per term: leave it in English when researchers in the field say it in English day to day (transformer, KV cache, test-time scaling, reflection, agent); write it in Chinese when a standard Chinese term exists and loses nothing in translation (latency, energy, throughput, datacenter, accuracy).
- Do not expand an obscure abbreviation in parentheses; pick one language for its full form and use that.`
  },
  en: {
    name: "English",
    overviewLength: "300-450 words",
    styleRules: `- Use a term's established name; do not invent expansions for well-known abbreviations.
- Explain an unfamiliar term the first time it appears, in one clause, rather than in a parenthetical gloss every time.
- Prefer plain words over the paper's own phrasing: write for a researcher in a neighbouring area, not for the authors.`
  }
};

export function analysisPrompt(
  language: OutputLanguage,
  paper: ArxivPaper,
  topics: string[]
): Prompt {
  const profile = LANGUAGE_PROFILES[language];

  return {
    system: `You are a computer-systems research assistant who analyses papers on systems for large models. Write every analysis in ${profile.name}, in plain language, explaining technical concepts clearly. Return pure JSON.

Style rules for ${profile.name}:
${profile.styleRules}`,
    user: `Analyse this paper in detail and summarise it in plain ${profile.name}.

Title: ${paper.title}
arXiv: ${paper.arxivId}
Authors: ${paper.authors.join(", ")}
Abstract: ${paper.abstract}

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

  return {
    system: `You analyse research trends in systems for large models. Write in ${profile.name}, in plain language. Return pure JSON.

Style rules for ${profile.name}:
${profile.styleRules}`,
    user: `Write a briefing over today's ${analyses.length} recommended papers, in ${profile.name}.

The reader's research areas: ${topics.join(", ")}

Today's papers:
${paperSummaries}

Requirements:
1. Open with one sentence on the most notable direction today
2. Draw out 2-3 technical trends or observations
3. Point out how the papers relate (which ones tackle similar problems)
4. Recommend the 2-3 worth reading closely today
5. Write in plain ${profile.name}, following the style rules:
${profile.styleRules}

Return JSON:
{
  "overviewSummary": "the full briefing (${profile.name}, ${profile.overviewLength})"
}`
  };
}
