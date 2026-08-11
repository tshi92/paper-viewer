import { describe, expect, it } from "vitest";
import { maskApiKey } from "../src/llm-config";

describe("maskApiKey", () => {
  it("keeps prefix and last 4, masks the middle", () => {
    expect(maskApiKey("sk-abcdefghijklmnop")).toBe("sk-***mnop");
  });

  it("fully masks short keys", () => {
    expect(maskApiKey("short")).toBe("***");
  });

  it("handles empty", () => {
    expect(maskApiKey("")).toBe("");
  });

  it("uses first three chars as prefix for non-sk keys", () => {
    expect(maskApiKey("abcdefghijklmnop")).toBe("abc***mnop");
  });
});
