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

  /**
   * A briefing long enough to satisfy the completeness gate for one paper
   * (the zh floor is half of 150 characters), ending on a full stop.
   */
  const validBriefing = "系统层正从静态资源分配转向动态调度，训练与推理的冗余消除是今天的关键主线，多篇论文从编译期与运行时两个方向逼近同一个问题。".repeat(2);

  /**
   * Captures the requests the helper would have sent and answers each from
   * `replies` in order (repeating the last one). Each reply is the body of
   * choices[0]: its message content and finish_reason.
   */
  function stubFetch(
    replies: { overview?: string; content?: string; finishReason?: string }[] = [{}]
  ) {
    let call = 0;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      void init;
      const reply = replies[Math.min(call, replies.length - 1)]!;
      call += 1;
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: reply.finishReason ?? "stop",
              message: {
                content:
                  reply.content ??
                  JSON.stringify({ overviewSummary: reply.overview ?? validBriefing })
              }
            }
          ]
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

    expect(summary).toBe(validBriefing);
    expect(bodyOf(fetchMock).thinking).toEqual({ type: "disabled" });
  });

  it("turns it off for DeepSeek V4 too, which thinks by default in the same field", async () => {
    const fetchMock = stubFetch();
    await generateOverview(configFor("deepseek-v4-pro"), [analysis], ["llm serving"], "zh");

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

  it("treats a briefing the provider cut short as a failure, not an answer", async () => {
    // 2026-08-27: the model answered with ~150 characters, mid-sentence, inside
    // syntactically valid JSON. It sailed through parsing and shipped.
    const fragment = "今日最值得关注的方向是协同演进：共同推动着大模型系统从";
    stubFetch([{ overview: fragment }, { overview: fragment }]);

    await expect(
      generateOverview(configFor("deepseek-v4-pro"), [analysis], [], "zh")
    ).rejects.toThrow(/incomplete/i);
  });

  it("retries once and returns the second answer when it is whole", async () => {
    const fetchMock = stubFetch([{ overview: "半句话就停在了这" }, {}]);

    const summary = await generateOverview(configFor("deepseek-v4-pro"), [analysis], [], "zh");

    expect(summary).toBe(validBriefing);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not accept a response whose finish_reason says it was truncated", async () => {
    stubFetch([{ finishReason: "length" }, { finishReason: "content_filter" }]);

    await expect(
      generateOverview(configFor("deepseek-v4-pro"), [analysis], [], "zh")
    ).rejects.toThrow(/length|content_filter/);
  });
});
