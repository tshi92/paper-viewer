import { describe, expect, it } from "vitest";
import { invariant } from "../src/validation";

describe("invariant", () => {
  it("throws when the condition is false", () => {
    expect(() => invariant(false, "boom")).toThrow("boom");
  });
});
