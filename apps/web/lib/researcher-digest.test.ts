import { describe, expect, it } from "vitest";
import { DIGEST_EXAMPLE } from "./prompts";
import { buildDigestInput, splitHighlights, textLength, validateDigest, type DigestInput, type WindowPaper } from "./researcher-digest";

const WINDOW = { from: "2026-06-29", to: "2026-09-28" };

/** The first listed researcher is the last author; any others are first authors. */
const wp = (id: string, directionId: string, slugs: string[]): WindowPaper => ({
  id: `db-${id}`, arxivId: id, title: `T${id}`, abstract: "a", authors: ["A0", "A1", "A2"],
  published: "2026-09-01", directionId,
  researchers: slugs.map((slug, i) => ({ slug, name: slug, position: i === 0 ? 3 : 1 }))
});

describe("buildDigestInput", () => {
  const input = buildDigestInput({
    papers: [wp("2609.00001", "llm-serving", ["ion"]), wp("2609.00002", "llm-serving", ["minlan"]),
             wp("2609.00003", "moe-disaggregation", ["xin"]), wp("2609.00004", "other", ["ion"])],
    researcherCount: 11, language: "zh", window: WINDOW
  });

  it("counts papers and distinct people per direction and skips empty ones", () => {
    expect(input.directions.find((d) => d.id === "llm-serving")).toMatchObject({ label: "LLM 推理服务", papers: 2, people: 2 });
    expect(input.directions.some((d) => d.id === "ai-security")).toBe(false);
    expect(input.stats).toEqual({ papers: 4, researchers: 11 });
  });

  it("counts multi-direction families so cross-direction figures are citable", () => {
    expect(input.families.find((f) => f.family === "inference")).toMatchObject({ papers: 3, people: 3 });
    expect(input.families.some((f) => f.family === "security")).toBe(false);
  });

  it("names papers by arXiv id and researchers by role", () => {
    expect(input.papers[0]).toMatchObject({ id: "2609.00001", direction: "llm-serving", researchers: [{ name: "ion", role: "last author" }] });
  });
});

describe("highlights and length", () => {
  it("splits [[id|text]] into parts", () => {
    expect(splitHighlights("做的最多的是[[llm-serving|LLM 推理服务]]（7 位）。")).toEqual([
      { text: "做的最多的是" }, { text: "LLM 推理服务", directionId: "llm-serving" }, { text: "（7 位）。" }
    ]);
    expect(splitHighlights("plain")).toEqual([{ text: "plain" }]);
  });

  it("counts a CJK character or a Latin word as one unit, ignoring markup", () => {
    expect(textLength("推理系统开始按 agent 的样子重新设计。")).toBe(15);
    expect(textLength("[[llm-serving|LLM 推理服务]]")).toBe(5);
  });
});

const stub = (id: string, direction: string, researchers = ["A", "B"]) => ({
  id, title: id, abstract: "", direction, date: "2026-09-01", researchers: researchers.map((name) => ({ name, role: "last author" }))
});

describe("validateDigest", () => {
  const input: DigestInput = {
    window: WINDOW, stats: { papers: 4, researchers: 11 }, families: [],
    directions: [{ id: "llm-serving", label: "LLM 推理服务", papers: 3, people: 3 }, { id: "other", label: "其他", papers: 1, people: 1 }],
    papers: [
      stub("2609.00001", "llm-serving", ["Ion"]), stub("2609.00002", "llm-serving", ["Minlan"]),
      stub("2609.00003", "llm-serving", ["Haibo", "Ion"]), stub("2609.00004", "other", ["Ion"])
    ]
  };
  const theme = (title: string, papers = ["2609.00001", "2609.00002"]) => ({ title, insight: "为什么现在是个问题。", papers });
  const good = {
    headline: "推理服务仍是重心",
    lede: "11 位研究者发了 4 篇论文，做的人最多的是[[llm-serving|LLM 推理服务]]（3 位）。",
    themes: [theme("跨两人。"), theme("跨三人。", ["2609.00001", "2609.00002", "2609.00003"])],
    surprise: { text: "简单方法不输复杂方法。", paper: "2609.00001" }
  };
  const verdictOf = (issue: unknown, language: "zh" | "en" = "zh") => validateDigest(issue, input, language);
  const errorsOf = (issue: unknown) => verdictOf(issue).errors.join("\n");

  it("accepts a well-formed issue, counting each theme's researchers and putting the widest first", () => {
    const verdict = verdictOf(good);
    expect(verdict.errors).toEqual([]);
    expect(verdict.content?.themes.map((t) => [t.title, t.researchers])).toEqual([["跨三人。", 3], ["跨两人。", 2]]);
    expect(verdict.content?.surprise).toEqual(good.surprise);
  });

  it("refuses numbers the statistics do not hold, banned phrasing, and the wrong language", () => {
    expect(errorsOf({ ...good, lede: "共 99 篇。" })).toMatch(/number 99/);
    expect(errorsOf({ ...good, lede: "完全没碰 agent 的只有一位。" })).toMatch(/banned/);
    expect(errorsOf({ ...good, headline: "推理——仍是重心" })).toMatch(/banned/);
    expect(errorsOf({ ...good, headline: "Serving is still the center", lede: "Agents reshape it." })).toMatch(/write in Simplified Chinese/);
  });

  it("leaves out a theme one researcher works on, or one citing a paper outside the window", () => {
    const verdict = verdictOf({ ...good, themes: [...good.themes, theme("只有一人。", ["2609.00001", "2609.00004"]), theme("引了窗口外的论文。", ["2609.00001", "2609.00002", "2601.99999"])] });
    expect(verdict.content?.themes.map((t) => t.title)).toEqual(["跨三人。", "跨两人。"]);
    expect(verdict.dropped).toEqual([
      "theme 3: the papers must span at least 2 researchers",
      "theme 4: paper 2601.99999 is not in the window"
    ]);
  });

  it("drops a failing surprise without refusing the issue", () => {
    const verdict = verdictOf({ ...good, surprise: { text: "反直觉。", paper: "2601.99999" } });
    expect(verdict.content?.surprise).toBeNull();
    expect(verdict.dropped).toEqual(["surprise: paper 2601.99999 is not in the window"]);
    expect(verdictOf({ ...good, surprise: null }).content?.surprise).toBeNull();
  });

  it("allows lengths a quarter over their targets", () => {
    expect(verdictOf({ ...good, headline: "推".repeat(37) }).content).not.toBeNull();
    expect(errorsOf({ ...good, headline: "推".repeat(39) })).toMatch(/headline must be 1-38 .* \(aim for 30\)/);
  });

  it("shows a highlight naming no known direction as plain text", () => {
    expect(verdictOf({ ...good, lede: "[[inference|推理]]仍是重心。" }).content?.lede).toBe("推理仍是重心。");
  });

  it("refuses the issue when fewer than 2 themes pass, reporting every failure for the retry", () => {
    const errors = errorsOf({ ...good, themes: [good.themes[0], { ...theme("推".repeat(26)) }] });
    expect(errors).toMatch(/2-4 items .* \(1 of 2 did\)/);
    expect(errors).toMatch(/theme 2: title must be 1-25/);
  });

  it("enforces sentence limits", () => {
    expect(errorsOf({ ...good, lede: "一。二。三。" })).toMatch(/at most 2 sentences/);
    const twoSentences = { ...theme("两句例证。"), insight: "一。二。" };
    expect(verdictOf({ ...good, themes: [...good.themes, twoSentences] }).dropped).toEqual(["theme 3: insight must be one sentence"]);
  });

  it("accepts the example issue the prompt carries", () => {
    // The few-shot must obey every rule it teaches.
    const ids = [...DIGEST_EXAMPLE.themes.flatMap((t) => t.papers), DIGEST_EXAMPLE.surprise.paper];
    const example: DigestInput = {
      window: WINDOW, stats: { papers: 41, researchers: 11 }, families: [],
      directions: [{ id: "llm-serving", label: "LLM 推理服务", papers: 12, people: 7 }],
      papers: ids.map((id, i) => stub(id, "llm-serving", [`R${i}`]))
    };
    expect(validateDigest(DIGEST_EXAMPLE, example, "zh")).toMatchObject({ errors: [], dropped: [] });
  });
});
