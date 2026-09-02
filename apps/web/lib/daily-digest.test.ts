import { describe, expect, it } from "vitest";
import {
  isDigestComplete,
  isUniqueViolation,
  latestAnalysisPerPaper,
  papersToRequeue,
  pickLeadDigest,
  placeholderOverview,
  summaryLineOf,
  toArxivPaper
} from "./daily-digest";

const wholeBriefing =
  "今天的三篇论文都在讲 KV cache 复用，从训练与推理两个方向逼近同一个问题，值得放在一起读。".repeat(6);

function digest(overrides: Partial<Parameters<typeof isDigestComplete>[0]> = {}) {
  return {
    overviewSummary: wholeBriefing,
    pendingPaperIds: [] as string[],
    paperIds: ["p1", "p2", "p3"],
    feishuSentAt: null as Date | null,
    ...overrides
  };
}

describe("isDigestComplete", () => {
  it("is complete when nothing is pending, the overview is whole and no webhook is configured", () => {
    expect(isDigestComplete(digest(), false, "zh")).toBe(true);
  });

  it("is incomplete while papers are still pending", () => {
    expect(isDigestComplete(digest({ pendingPaperIds: ["p1"] }), false, "zh")).toBe(false);
  });

  it("is incomplete while the overview is empty or blank", () => {
    expect(isDigestComplete(digest({ overviewSummary: "" }), false, "zh")).toBe(false);
    expect(isDigestComplete(digest({ overviewSummary: "   \n" }), false, "zh")).toBe(false);
  });

  it("is incomplete while the overview is the placeholder or a fragment", () => {
    // 2026-08-27: a mid-sentence fragment counted as done here, so every later
    // run answered skipped_done and the broken text could never heal in place.
    expect(
      isDigestComplete(digest({ overviewSummary: placeholderOverview(3) }), false, "zh")
    ).toBe(false);
    expect(
      isDigestComplete(digest({ overviewSummary: "今日最值得关注的方向是协同演进：推动着大模型系统从" }), false, "zh")
    ).toBe(false);
  });

  it("judges the briefing against the analysed papers, not the day's full pick", () => {
    // A day sealed with 3 of 10 papers analysed has a 3-paper briefing. Held
    // to a 10-paper length floor it reads as incomplete, which is what used to
    // reopen the day on every run and regenerate a briefing already shipped.
    const partialDay = digest({ paperIds: Array.from({ length: 10 }, (_, i) => `p${i}`) });
    expect(isDigestComplete(partialDay, false, "zh")).toBe(false);
    expect(isDigestComplete(partialDay, false, "zh", 3)).toBe(true);
  });

  it("waits for the feishu push when a webhook is configured", () => {
    expect(isDigestComplete(digest(), true, "zh")).toBe(false);
    expect(isDigestComplete(digest({ feishuSentAt: new Date("2026-08-11T01:00:00Z") }), true, "zh")).toBe(true);
  });
});

describe("placeholderOverview", () => {
  // A run where every analysis failed writes this instead of a briefing. It has
  // to be recognisable by value, because that is how a later run knows the text
  // is a stand-in it may replace rather than a real overview.
  it("is stable for a given paper count, so a later run can recognise it", () => {
    expect(placeholderOverview(4)).toBe(placeholderOverview(4));
    expect(placeholderOverview(4)).not.toBe(placeholderOverview(3));
  });

  it("fails the completeness judgement, so a later run replaces it", () => {
    const stub = placeholderOverview(4);
    expect(stub.trim()).not.toBe("");
    expect(
      isDigestComplete(
        { overviewSummary: stub, pendingPaperIds: [], paperIds: ["a", "b", "c", "d"], feishuSentAt: null },
        false,
        "zh"
      )
    ).toBe(false);
  });
});

describe("papersToRequeue", () => {
  it("returns the papers with no analysis, in the digest's order", () => {
    expect(papersToRequeue(["p1", "p2", "p3"], new Set(["p2"]))).toEqual(["p1", "p3"]);
  });

  it("returns nothing once every paper has one", () => {
    expect(papersToRequeue(["p1", "p2"], new Set(["p1", "p2"]))).toEqual([]);
    expect(papersToRequeue([], new Set())).toEqual([]);
  });

  it("returns every paper when a whole run failed", () => {
    // The case this exists for: an LLM outage or a rate-limited account fails
    // all of them, and each one is dequeued so it cannot block the digest.
    expect(papersToRequeue(["p1", "p2", "p3"], new Set())).toEqual(["p1", "p2", "p3"]);
  });

  it("ignores analyses of papers outside this digest", () => {
    expect(papersToRequeue(["p1"], new Set(["p9"]))).toEqual(["p1"]);
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

  it("ends an English sentence at its period, but not mid-number", () => {
    // The workspace can ask for English intros, so the line has to end
    // somewhere sensible in Latin script too.
    expect(summaryLineOf("Reuses KV cache across requests. Tested on a trace.")).toBe(
      "Reuses KV cache across requests."
    );
    expect(summaryLineOf("Throughput rises 2.1x with no accuracy loss. Details follow.")).toBe(
      "Throughput rises 2.1x with no accuracy loss."
    );
    expect(summaryLineOf("Does it help? Yes, on every trace.")).toBe("Does it help?");
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
    // A bare object is accepted too: the concurrency path only cares about the
    // code and does not depend on Prisma's error class
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

/**
 * The Today page's main content is the briefing card, and which digest it holds
 * cannot simply be "today's": the date key rolls over at 00:00 UTC (08:00
 * Beijing) while the run happens at the push hour, 13:00 by default. A strict
 * match would blank the page for those hours every single morning — the window
 * where a reader arrives before the day's papers exist.
 */
describe("pickLeadDigest", () => {
  const day = (iso: string) => ({ date: new Date(`${iso}T00:00:00Z`), tag: iso });
  const TODAY = "2026-08-21";

  it("prefers today's digest when the day's run has landed", () => {
    const digests = [day(TODAY), day("2026-08-20"), day("2026-08-19")];
    expect(pickLeadDigest(digests, TODAY)?.tag).toBe(TODAY);
  });

  it("holds the previous edition through the window before the run", () => {
    // No entry for TODAY: the date has rolled over, the digest has not run.
    const digests = [day("2026-08-20"), day("2026-08-19")];
    expect(pickLeadDigest(digests, TODAY)?.tag).toBe("2026-08-20");
  });

  it("holds the last edition there was, however old — a gap is not a blank page", () => {
    // Friday's, seen on Monday morning: still the most recent thing written.
    const digests = [day("2026-08-14")];
    expect(pickLeadDigest(digests, "2026-08-17")?.tag).toBe("2026-08-14");
  });

  it("has nothing to lead with only when nothing has ever run", () => {
    expect(pickLeadDigest([], TODAY)).toBeUndefined();
  });

  it("does not depend on today's being first in the list", () => {
    // The page orders by date desc, but the fallback must not be positional.
    const digests = [day("2026-08-20"), day(TODAY)];
    expect(pickLeadDigest(digests, TODAY)?.tag).toBe(TODAY);
  });
});
