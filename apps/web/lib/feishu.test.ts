import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDigestCard, sendFeishuCard, type DigestCardInput } from "./feishu";

type CardElement = { tag: string; text: { tag: string; content: string } };
type Card = {
  header: { template: string; title: { tag: string; content: string } };
  elements: CardElement[];
};

function buildCard(overrides: Partial<DigestCardInput> = {}): Card {
  return buildDigestCard({
    date: "2026-08-11",
    overview: "今天三篇都在讲长上下文注意力。",
    papers: [
      { id: "p1", title: "Attention Is All You Need", summaryLine: "提出 Transformer 架构。" },
      { id: "p2", title: "Flash Attention", summaryLine: "用分块 IO 感知算法加速注意力。" }
    ],
    appUrl: "https://paper-viewer-five.vercel.app",
    ...overrides
  }) as Card;
}

describe("buildDigestCard", () => {
  it("puts the paper count and date in a blue header", () => {
    const card = buildCard();
    expect(card.header.template).toBe("blue");
    expect(card.header.title.content).toBe("📄 今日论文 · 2 篇（2026-08-11）");
  });

  it("counts only the papers it was given", () => {
    const card = buildCard({ papers: [{ id: "solo", title: "Solo", summaryLine: "一篇。" }] });
    expect(card.header.title.content).toContain("· 1 篇");
  });

  it("renders one lark_md element per paper, numbered and linked", () => {
    const card = buildCard();
    // 1 个总览 + 2 篇
    expect(card.elements).toHaveLength(3);
    const [, first, second] = card.elements as [CardElement, CardElement, CardElement];

    expect(first.text.tag).toBe("lark_md");
    expect(first.text.content).toBe(
      "**1. [Attention Is All You Need](https://paper-viewer-five.vercel.app/papers/p1)**\n提出 Transformer 架构。"
    );
    expect(second.text.content).toBe(
      "**2. [Flash Attention](https://paper-viewer-five.vercel.app/papers/p2)**\n用分块 IO 感知算法加速注意力。"
    );
  });

  it("normalizes a trailing slash on appUrl so links never double up", () => {
    const card = buildCard({ appUrl: "https://paper-viewer-five.vercel.app/" });
    expect(card.elements[1]?.text.content).toContain(
      "(https://paper-viewer-five.vercel.app/papers/p1)"
    );
    expect(card.elements[1]?.text.content).not.toContain("app//papers");
  });

  it("escapes brackets in titles so the markdown link cannot break", () => {
    const card = buildCard({
      papers: [{ id: "p1", title: "SAM [v2] for Video", summaryLine: "分割一切的续作。" }]
    });
    const content = card.elements[1]?.text.content ?? "";
    expect(content).toContain("\\[v2\\]");
    expect(content).toBe(
      "**1. [SAM \\[v2\\] for Video](https://paper-viewer-five.vercel.app/papers/p1)**\n分割一切的续作。"
    );
  });

  it("emits a leading overview element only when the overview is non-empty", () => {
    const withOverview = buildCard();
    expect(withOverview.elements[0]?.text.content).toBe("今天三篇都在讲长上下文注意力。");

    const withoutOverview = buildCard({ overview: "" });
    expect(withoutOverview.elements).toHaveLength(2);
    expect(withoutOverview.elements[0]?.text.content).toContain("**1. [");

    const blankOverview = buildCard({ overview: "   " });
    expect(blankOverview.elements).toHaveLength(2);
  });

  it("survives an empty paper list without throwing", () => {
    const card = buildCard({ papers: [], overview: "" });
    expect(card.header.title.content).toBe("📄 今日论文 · 0 篇（2026-08-11）");
    expect(card.elements).toEqual([]);
  });
});

const WEBHOOK = "https://open.feishu.cn/open-apis/bot/v2/hook/test-token";
/** 注入零延迟，测试不真的等退避的 1s/2s */
const noDelay = { delay: async () => {} };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("sendFeishuCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the card as an interactive message and reports success on code 0", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { code: 0, msg: "success" }));
    vi.stubGlobal("fetch", fetchMock);

    const card = buildCard();
    await expect(sendFeishuCard(WEBHOOK, card, noDelay)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ msg_type: "interactive", card });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("retries after transient 500s and succeeds on the third attempt", async () => {
    const fetchMock = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(jsonResponse(200, { code: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendFeishuCard(WEBHOOK, buildCard(), noDelay)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after three network failures and returns false without throwing", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", fetchMock);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendFeishuCard(WEBHOOK, buildCard(), noDelay)).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(errorSpy).toHaveBeenCalledWith("[feishu]", expect.stringContaining("attempt"), expect.anything());
  });

  it("treats a non-zero business code as a failure even on HTTP 200", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { code: 19001, msg: "param invalid" })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sendFeishuCard(WEBHOOK, buildCard(), noDelay)).resolves.toBe(false);
  });

  it("accepts the legacy StatusCode 0 response shape", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { StatusCode: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendFeishuCard(WEBHOOK, buildCard(), noDelay)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
