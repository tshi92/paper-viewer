import { describe, expect, it } from "vitest";
import { invariant } from "@paper-viewer/core";

describe("invariant", () => {
  it("throws when the condition is false", () => {
    expect(() => invariant(false, "boom")).toThrow("boom");
  });
});
