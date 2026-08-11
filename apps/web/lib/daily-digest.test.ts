import { describe, expect, it } from "vitest";
import {
  isDigestComplete,
  isUniqueViolation,
  latestAnalysisPerPaper,
  summaryLineOf,
  toArxivPaper
} from "./daily-digest";

function digest(overrides: Partial<Parameters<typeof isDigestComplete>[0]> = {}) {
  return {
    overviewSummary: "今天的三篇论文都在讲 KV cache 复用。",
    pendingPaperIds: [] as string[],
    feishuSentAt: null as Date | null,
    ...overrides
  };
}

describe("isDigestComplete", () => {
  it("is complete when nothing is pending, the overview exists and no webhook is configured", () => {
    expect(isDigestComplete(digest(), false)).toBe(true);
  });

  it("is incomplete while papers are still pending", () => {
    expect(isDigestComplete(digest({ pendingPaperIds: ["p1"] }), false)).toBe(false);
  });

  it("is incomplete while the overview is empty or blank", () => {
    expect(isDigestComplete(digest({ overviewSummary: "" }), false)).toBe(false);
    expect(isDigestComplete(digest({ overviewSummary: "   \n" }), false)).toBe(false);
  });

  it("waits for the feishu push when a webhook is configured", () => {
    expect(isDigestComplete(digest(), true)).toBe(false);
    expect(isDigestComplete(digest({ feishuSentAt: new Date("2026-08-11T01:00:00Z") }), true)).toBe(true);
  });
});

describe("summaryLineOf", () => {
  it("keeps the first sentence including its punctuation", () => {
    expect(summaryLineOf("提出了一种新的 attention 稀疏化方法。实验在 8 张卡上完成。")).toBe(
      "提出了一种新的 attention 稀疏化方法。"
    );
  });

  it("collapses whitespace and trims", () => {
    expect(summaryLineOf("  本文提出\n  一个新方法。后续内容  ")).toBe("本文提出 一个新方法。");
  });

  it("truncates with an ellipsis when the first sentence is too long", () => {
    const line = summaryLineOf(`${"很长".repeat(60)}。`);
    expect(line).toHaveLength(81);
    expect(line.endsWith("…")).toBe(true);
  });

  it("truncates when there is no sentence terminator at all", () => {
    expect(summaryLineOf("短摘要没有句号")).toBe("短摘要没有句号");
    expect(summaryLineOf("а".repeat(200))).toHaveLength(81);
  });

  it("returns an empty string for missing summaries", () => {
    expect(summaryLineOf(null)).toBe("");
    expect(summaryLineOf(undefined)).toBe("");
    expect(summaryLineOf("   ")).toBe("");
  });
});

describe("toArxivPaper", () => {
  it("rebuilds the arXiv shape from a stored paper row", () => {
    const paper = toArxivPaper({
      id: "paper-1",
      title: "Scaling Laws for Sparse Attention",
      abstract: "We study sparse attention.",
      authors: ["Ada Lovelace", "Alan Turing"],
      arxivId: "2601.01234",
      publishedAt: new Date("2026-08-10T00:00:00Z")
    });

    expect(paper).toEqual({
      arxivId: "2601.01234",
      title: "Scaling Laws for Sparse Attention",
      abstract: "We study sparse attention.",
      authors: ["Ada Lovelace", "Alan Turing"],
      publishedAt: "2026-08-10T00:00:00.000Z",
      categories: [],
      url: "https://arxiv.org/abs/2601.01234"
    });
  });

  it("tolerates null columns and a non-array authors json blob", () => {
    const paper = toArxivPaper({
      id: "paper-2",
      title: "Untitled",
      abstract: null,
      authors: { nope: true },
      arxivId: null,
      publishedAt: null
    });

    expect(paper.abstract).toBe("");
    expect(paper.authors).toEqual([]);
    expect(paper.arxivId).toBe("");
    expect(paper.publishedAt).toBe("");
    expect(paper.url).toBe("");
  });
});

describe("isUniqueViolation", () => {
  it("recognises the prisma unique-constraint code", () => {
    const error = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    expect(isUniqueViolation(error)).toBe(true);
    // 裸对象也认：并发路径只关心 code，不依赖 Prisma 的错误类
    expect(isUniqueViolation({ code: "P2002" })).toBe(true);
  });

  it("does not swallow other failures", () => {
    expect(isUniqueViolation(Object.assign(new Error("nope"), { code: "P2025" }))).toBe(false);
    expect(isUniqueViolation(new Error("connection reset"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("P2002")).toBe(false);
  });
});

describe("latestAnalysisPerPaper", () => {
  it("keeps the last row per paper when rows arrive oldest-first", () => {
    const byPaper = latestAnalysisPerPaper([
      { paperId: "a", summary: "旧的" },
      { paperId: "b", summary: "b 的唯一一条" },
      { paperId: "a", summary: "新的" }
    ]);

    expect(byPaper.size).toBe(2);
    expect(byPaper.get("a")?.summary).toBe("新的");
    expect(byPaper.get("b")?.summary).toBe("b 的唯一一条");
  });

  it("returns an empty map for no rows", () => {
    expect(latestAnalysisPerPaper([]).size).toBe(0);
  });
});
