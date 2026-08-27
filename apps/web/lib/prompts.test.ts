import { describe, expect, it } from "vitest";
import { analysisPrompt, isCompleteOverview, overviewPrompt } from "./prompts";
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

describe("analysisPrompt source material", () => {
  it("defaults to the paper's own abstract", () => {
    expect(analysisPrompt("en", paper, []).user).toContain(paper.abstract);
  });

  it("takes full text instead, and says the paper has no abstract", () => {
    const prompt = analysisPrompt("en", paper, [], {
      kind: "fullText",
      text: "1 Introduction\nThe system reuses KV cache blocks."
    });
    expect(prompt.user).toContain("The system reuses KV cache blocks.");
    expect(prompt.user).toContain("this paper has no abstract on file");
    // The abstract must not travel too: a catalog paper's is empty anyway, and
    // two source blocks would leave the model deciding which one to trust.
    expect(prompt.user).not.toContain(`Abstract: ${paper.abstract}`);
  });

  it("truncates full text, so one 40-page PDF cannot become the whole prompt", () => {
    const long = "x".repeat(60_000);
    const prompt = analysisPrompt("zh", paper, [], { kind: "fullText", text: long });
    expect(prompt.user).toContain("x".repeat(1000));
    expect(prompt.user.length).toBeLessThan(50_000);
  });
});

describe("overviewPrompt", () => {
  it("names the language and its length guidance, staying in English", () => {
    const chinese = overviewPrompt("zh", [analysis], ["llm serving"]);
    expect(chinese.user).toContain("Simplified Chinese, 150-200 characters");
    expect(chinese.system).not.toMatch(CJK);
    expect(chinese.user).not.toMatch(CJK);

    expect(overviewPrompt("en", [analysis], []).user).toContain("English, 80-120 words");
  });

  it("scales the length target with the number of papers", () => {
    const ten = Array.from({ length: 10 }, (_, i) => ({ ...analysis, title: `Paper ${i}` }));
    expect(overviewPrompt("zh", ten, []).user).toContain("1500-2000 characters");
    expect(overviewPrompt("en", ten, []).user).toContain("800-1200 words");
  });

  it("summarises every analysis it was given", () => {
    const prompt = overviewPrompt("en", [analysis, { ...analysis, title: "Second Paper" }], []);
    expect(prompt.user).toContain(paper.title);
    expect(prompt.user).toContain("Second Paper");
    expect(prompt.user).toContain("today's 2 recommended papers");
  });
});

describe("isCompleteOverview", () => {
  const sentence = "系统层正从静态资源分配转向动态调度，训练与推理的冗余消除是关键。";

  function briefingOf(chars: number): string {
    return sentence.repeat(Math.ceil(chars / sentence.length));
  }

  it("accepts a briefing at the target length that ends on a full stop", () => {
    expect(isCompleteOverview(briefingOf(1600), 10, "zh")).toBe(true);
  });

  it("rejects the fragment that shipped on 2026-08-27", () => {
    // Verbatim from production: valid JSON around it, ~150 characters over ten
    // papers, cut mid-sentence. It passed every check we had.
    const fragment =
      "今日最值得关注的方向是**agentic AI 训练系统与新兴加速器软件栈的协同演进**：" +
      "psRL 揭示了 training-time prefix sharing 在 update 阶段的巨大潜力，而 Zomboss " +
      "和 TensorLift 则从相反方向重构了 agent 与编译器的职责边界，共同推动着大模型系统从";
    expect(isCompleteOverview(fragment, 10, "zh")).toBe(false);
  });

  it("rejects the placeholder, so a later run replaces it", () => {
    expect(isCompleteOverview("今日推荐 10 篇论文。", 10, "zh")).toBe(false);
    expect(isCompleteOverview("", 10, "zh")).toBe(false);
  });

  it("rejects a long briefing that still stops mid-sentence", () => {
    expect(isCompleteOverview(briefingOf(1600) + "共同推动着大模型系统从", 10, "zh")).toBe(false);
  });

  it("looks through closing markdown and quotes for the final stop", () => {
    expect(isCompleteOverview(briefingOf(1600) + "值得**精读**。", 10, "zh")).toBe(true);
    expect(isCompleteOverview(briefingOf(160) + "「值得精读。」", 1, "zh")).toBe(true);
  });

  it("counts words rather than characters for English", () => {
    const words = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ") + ".";
    expect(isCompleteOverview(words, 1, "en")).toBe(true);
    expect(isCompleteOverview(words, 10, "en")).toBe(false); // 100 words, floor is 400
  });
});
