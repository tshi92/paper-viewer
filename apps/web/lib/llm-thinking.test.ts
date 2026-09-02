import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeSinglePaper, selectPapers } from "./llm";
import type { ArxivPaper } from "./arxiv";
import type { LlmRuntimeConfig } from "./llm-config";

/**
 * Selection and per-paper analysis are extraction calls, and on reasoning
 * models the thinking pass is what spends their 120s timeout (2026-09-01/02:
 * kimi-k3 analyses timed out paper after paper, which is why intros went
 * missing from the day's digest). generateOverview has carried the field since
 * the k2.5 fix; these pin that the other two call sites now send it too — and
 * that non-Moonshot providers still never see the field.
 */
const paper: ArxivPaper = {
  arxivId: "2609.00001",
  title: "A fixture paper",
  abstract: "Sparse attention for long-context inference.",
  authors: ["A. Author"],
  publishedAt: "2026-09-01T00:00:00Z",
  categories: ["cs.LG"],
  url: "https://arxiv.org/abs/2609.00001"
};

const analysisReply = {
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
};

function configFor(model: string): LlmRuntimeConfig {
  return { baseUrl: "https://llm.example/v1", model, apiKey: "sk-test" };
}

function stubFetch(content: unknown) {
  const fetchMock = vi.fn(
    async (_url: string, init: RequestInit) => {
      void init;
      return respond(content);
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function respond(content: unknown): Response {
  return (
      new Response(
        JSON.stringify({
          choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }]
        }),
        { status: 200 }
      )
  );
}

function bodyOf(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
  return JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("selectPapers", () => {
  it("turns the reasoning pass off on Moonshot models", async () => {
    const fetchMock = stubFetch({ selectedArxivIds: [paper.arxivId] });
    await selectPapers({
      config: configFor("kimi-k3"),
      papers: [paper],
      topics: ["LLM systems"],
      keywords: [],
      excludedTopics: [],
      papersPerDay: 1
    });
    expect(bodyOf(fetchMock).thinking).toEqual({ type: "disabled" });
  });

  it("sends no thinking field to providers that never defined one", async () => {
    const fetchMock = stubFetch({ selectedArxivIds: [paper.arxivId] });
    await selectPapers({
      config: configFor("gpt-4o-mini"),
      papers: [paper],
      topics: [],
      keywords: [],
      excludedTopics: [],
      papersPerDay: 1
    });
    expect(bodyOf(fetchMock)).not.toHaveProperty("thinking");
  });
});

describe("analyzeSinglePaper", () => {
  it("turns the reasoning pass off on Moonshot models", async () => {
    const fetchMock = stubFetch(analysisReply);
    await analyzeSinglePaper(configFor("kimi-k3"), paper, ["LLM systems"], "zh");
    expect(bodyOf(fetchMock).thinking).toEqual({ type: "disabled" });
  });
});
