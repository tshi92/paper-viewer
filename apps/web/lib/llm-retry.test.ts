import { afterEach, describe, expect, it, vi } from "vitest";
import { requestChatCompletions } from "./llm";
import type { LlmRuntimeConfig } from "./llm-config";

const config: LlmRuntimeConfig = {
  baseUrl: "https://llm.example/v1",
  model: "test-model",
  apiKey: "sk-test"
};

/**
 * Low-tier Kimi orgs allow a single concurrent request, so a chat racing the
 * digest pipeline gets an instant 429; the helper must absorb short collisions
 * and give up cleanly on persistent ones.
 */
describe("requestChatCompletions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(responses: Response[]) {
    const fetchMock = vi.fn(async () => {
      const next = responses.shift();
      if (!next) throw new Error("fetch called more often than stubbed");
      return next;
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("returns the first successful response without retrying", async () => {
    const fetchMock = stubFetch([new Response("{}", { status: 200 })]);
    const res = await requestChatCompletions(config, {}, { retryDelaysMs: [0, 0] });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and returns the eventual success", async () => {
    const fetchMock = stubFetch([
      new Response("busy", { status: 429 }),
      new Response("{}", { status: 200 })
    ]);
    const res = await requestChatCompletions(config, {}, { retryDelaysMs: [0, 0] });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after the delay schedule is exhausted", async () => {
    const fetchMock = stubFetch([
      new Response("busy", { status: 429 }),
      new Response("busy", { status: 429 }),
      new Response("busy", { status: 429 })
    ]);
    const res = await requestChatCompletions(config, {}, { retryDelaysMs: [0, 0] });
    expect(res.status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retriable client errors", async () => {
    const fetchMock = stubFetch([new Response("bad request", { status: 400 })]);
    const res = await requestChatCompletions(config, {}, { retryDelaysMs: [0, 0] });
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The body must remain readable by the caller for its error message.
    expect(await res.text()).toBe("bad request");
  });
});
