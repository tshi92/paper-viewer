import { describe, expect, it } from "vitest";
import { maskWebhookUrl } from "../src/notify";

describe("maskWebhookUrl", () => {
  it("keeps origin and path but masks the token, keeping last 4", () => {
    expect(maskWebhookUrl("https://open.feishu.cn/open-apis/bot/v2/hook/abcd1234-56ef-7890-abcd-ef1234567890"))
      .toBe("https://open.feishu.cn/open-apis/bot/v2/hook/***7890");
  });
  it("masks short last segments entirely", () => {
    expect(maskWebhookUrl("https://example.com/hook/abc")).toBe("https://example.com/hook/***");
  });
  it("returns empty for empty or invalid urls", () => {
    expect(maskWebhookUrl("")).toBe("");
    expect(maskWebhookUrl("not a url")).toBe("");
  });
});
