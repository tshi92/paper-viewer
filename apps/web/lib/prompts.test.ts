import { describe, expect, it } from "vitest";
import { analysisPrompt, overviewPrompt } from "./prompts";
import type { PaperAnalysisResult } from "./llm";

const paper = {
  arxivId: "2608.01234",
  title: "Adaptive KV Caching",
  authors: ["Ada Lovelace"],
  abstract: "We reuse KV cache across requests.",
  publishedAt: "2026-08-13T00:00:00Z",
  categories: ["cs.DC"],
  url: "https://arxiv.org/abs/2608.01234"
};

const analysis = {
  title: paper.title,
  arxivId: paper.arxivId,
  summary: "s",
  motivation: "m",
  problem: "p",
  method: "me",
  keyFindings: "k",
  whyItMatters: "w",
  keywords: ["kv cache"],
  relevanceScore: 0.9
} as PaperAnalysisResult;

/** The prompts are English whatever they ask for; a stray CJK character means a leftover. */
const CJK = /[一-鿿]/;

describe("analysisPrompt", () => {
  it("names the requested output language without switching into it", () => {
    const chinese = analysisPrompt("zh", paper, ["llm serving"]);
    expect(chinese.system).toContain("Write every analysis in Simplified Chinese");
    expect(chinese.system).not.toMatch(CJK);
    expect(chinese.user).not.toMatch(CJK);

    const english = analysisPrompt("en", paper, ["llm serving"]);
    expect(english.system).toContain("Write every analysis in English");
  });

  it("carries each language's own style rules", () => {
    // The rule the user actually cares about: no parenthetical glosses in Chinese.
    expect(analysisPrompt("zh", paper, []).system).toContain("Never pair a term with its translation");
    expect(analysisPrompt("en", paper, []).system).toContain("do not invent expansions");
  });

  it("keeps keywords English in both languages: they are the shared tag vocabulary", () => {
    for (const language of ["zh", "en"] as const) {
      const prompt = analysisPrompt(language, paper, []);
      expect(prompt.user).toContain("english keyword1");
      expect(prompt.user).toContain("keywords are always English");
    }
  });

  it("carries the paper and the reader's topics into both languages", () => {
    for (const language of ["zh", "en"] as const) {
      const prompt = analysisPrompt(language, paper, ["llm serving"]);
      expect(prompt.user).toContain(paper.title);
      expect(prompt.user).toContain(paper.arxivId);
      expect(prompt.user).toContain("llm serving");
    }
  });
});

describe("overviewPrompt", () => {
  it("names the language and its length guidance, staying in English", () => {
    const chinese = overviewPrompt("zh", [analysis], ["llm serving"]);
    expect(chinese.user).toContain("Simplified Chinese, 400-600 characters");
    expect(chinese.system).not.toMatch(CJK);
    expect(chinese.user).not.toMatch(CJK);

    expect(overviewPrompt("en", [analysis], []).user).toContain("English, 300-450 words");
  });

  it("summarises every analysis it was given", () => {
    const prompt = overviewPrompt("en", [analysis, { ...analysis, title: "Second Paper" }], []);
    expect(prompt.user).toContain(paper.title);
    expect(prompt.user).toContain("Second Paper");
    expect(prompt.user).toContain("today's 2 recommended papers");
  });
});
