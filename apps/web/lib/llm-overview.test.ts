import { afterEach, describe, expect, it, vi } from "vitest";
import { generateOverview, type PaperAnalysisResult } from "./llm";
import type { LlmRuntimeConfig } from "./llm-config";

/**
 * The daily briefing reasons over every paper of the day at once. On kimi-k2.5
 * that reasoning pass alone ran past three minutes before the first character
 * of the answer, so the call was aborted by its own timeout and the digest fell
 * back to the "N papers today" placeholder — silently, every single day. These
 * tests pin the two things that fixed it, and the one that must not regress:
 * the field is Moonshot-specific and may not be sent to other providers.
 */
const analysis: PaperAnalysisResult = {
  title: "A paper",
  arxivId: "2608.01000",
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

describe("generateOverview", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Captures the request the helper would have sent, and answers it. */
  function stubFetch() {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ overviewSummary: "today's briefing" }) } }]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function bodyOf(fetchMock: ReturnType<typeof stubFetch>): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
  }

  it("turns the reasoning pass off for models that accept the field", async () => {
    const fetchMock = stubFetch();
    const summary = await generateOverview(configFor("kimi-k2.5"), [analysis], ["llm serving"], "zh");

    expect(summary).toBe("today's briefing");
    expect(bodyOf(fetchMock).thinking).toEqual({ type: "disabled" });
  });

  it("leaves the field off for other providers, which reject unknown keys", async () => {
    const fetchMock = stubFetch();
    await generateOverview(configFor("gpt-4o"), [analysis], ["llm serving"], "zh");

    expect(bodyOf(fetchMock)).not.toHaveProperty("thinking");
  });

  it("gives the briefing a longer ceiling than a per-paper analysis", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    stubFetch();
    await generateOverview(configFor("kimi-k2.5"), [analysis], ["llm serving"], "zh");

    // Comfortably past the 120s default, and still inside the cron route's 300s.
    expect(timeout).toHaveBeenCalledWith(180_000);
  });
});
