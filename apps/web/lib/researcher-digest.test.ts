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

const stub = (id: string, direction: string) => ({ id, title: id, abstract: "", direction, date: "2026-09-01", researchers: [] });

describe("validateDigest", () => {
  const input: DigestInput = {
    window: WINDOW, stats: { papers: 3, researchers: 11 }, families: [],
    directions: [{ id: "llm-serving", label: "LLM 推理服务", papers: 2, people: 2 }, { id: "other", label: "其他", papers: 1, people: 1 }],
    papers: [stub("2609.00001", "llm-serving"), stub("2609.00002", "llm-serving"), stub("2609.00003", "other")]
  };
  const obs = (claim: string, papers = ["2609.00001", "2609.00002"], directions = ["llm-serving"]) =>
    ({ claim, evidence: "例证一句。", directions, papers });
  const good = {
    headline: "推理服务仍是重心",
    lede: "11 位研究者发了 3 篇论文，做的人最多的是[[llm-serving|LLM 推理服务]]（2 位）。",
    observations: [obs("甲。"), obs("乙。"), obs("丙。"), obs("丁。")]
  };
  const errorsOf = (issue: unknown) => validateDigest(issue, input, "zh").errors.join("\n");

  it("accepts a well-formed issue", () => {
    expect(validateDigest(good, input, "zh")).toEqual({ content: good, errors: [] });
  });

  it("rejects numbers, directions and papers the input does not hold", () => {
    const errors = errorsOf({ ...good, lede: "共 99 篇，[[made-up|x]]。", observations: [...good.observations.slice(0, 3), obs("丁。", ["2609.00001", "2601.99999"])] });
    expect(errors).toMatch(/number 99/);
    expect(errors).toMatch(/made-up/);
    expect(errors).toMatch(/2601\.99999 is not in the window/);
  });

  it("rejects banned phrasing", () => {
    expect(errorsOf({ ...good, lede: "完全没碰 agent 的只有一位。" })).toMatch(/banned/);
    expect(errorsOf({ ...good, headline: "推理——仍是重心" })).toMatch(/banned/);
  });

  it("enforces counts, lengths and sentence limits", () => {
    expect(errorsOf({ ...good, observations: good.observations.slice(0, 3) })).toMatch(/4-5/);
    expect(errorsOf({ ...good, headline: "推".repeat(31) })).toMatch(/headline/);
    expect(errorsOf({ ...good, lede: "一。二。三。" })).toMatch(/at most 2 sentences/);
    expect(errorsOf({ ...good, observations: [{ ...obs("甲。"), evidence: "一。二。" }, ...good.observations.slice(1)] })).toMatch(/one sentence/);
  });

  it("requires each cited paper's direction among the declared ones (spec §5.3)", () => {
    const issue = { ...good, observations: [obs("甲。", ["2609.00001", "2609.00003"]), ...good.observations.slice(1)] };
    expect(errorsOf(issue)).toMatch(/2609\.00003 is other/);
  });

  it("accepts the approved issue the prompt uses as its example", () => {
    // The few-shot must obey every rule it teaches.
    const directionOf: Record<string, string> = {
      "2606.30560": "llm-serving", "2607.08565": "llm-serving", "2609.28870": "llm-serving", "2608.07009": "llm-serving",
      "2609.13592": "llm-serving", "2607.00760": "llm-serving", "2609.27040": "gpu-cluster", "2608.04450": "agents-for-systems",
      "2609.04476": "agents-for-systems", "2607.05391": "agent-harness", "2609.14237": "moe-disaggregation",
      "2607.18002": "moe-disaggregation", "2609.25442": "gpu-cluster", "2607.01083": "gpu-cluster"
    };
    const example: DigestInput = {
      window: WINDOW, stats: { papers: 41, researchers: 11 },
      directions: [{ id: "llm-serving", label: "LLM 推理服务", papers: 12, people: 7 }],
      families: [{ family: "agents", directions: ["agents-for-systems", "agent-harness"], papers: 12, people: 9 }],
      papers: Object.entries(directionOf).map(([id, direction]) => stub(id, direction))
    };
    expect(validateDigest(DIGEST_EXAMPLE, example, "zh").errors).toEqual([]);
  });
});
