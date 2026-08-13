import { describe, expect, it } from "vitest";
import {
  DEFAULT_OUTPUT_LANGUAGE,
  isOutputLanguage,
  maskApiKey,
  toOutputLanguage
} from "../src/llm-config";

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

describe("output language", () => {
  it("accepts the supported languages and nothing else", () => {
    expect(isOutputLanguage("zh")).toBe(true);
    expect(isOutputLanguage("en")).toBe(true);
    expect(isOutputLanguage("fr")).toBe(false);
    expect(isOutputLanguage(undefined)).toBe(false);
    expect(isOutputLanguage(null)).toBe(false);
  });

  it("falls back to Chinese for anything unrecognised, so a stale row cannot break a digest run", () => {
    expect(toOutputLanguage("en")).toBe("en");
    expect(toOutputLanguage("zh")).toBe("zh");
    expect(toOutputLanguage("de")).toBe(DEFAULT_OUTPUT_LANGUAGE);
    expect(toOutputLanguage(undefined)).toBe(DEFAULT_OUTPUT_LANGUAGE);
    expect(toOutputLanguage(42)).toBe(DEFAULT_OUTPUT_LANGUAGE);
  });
});
