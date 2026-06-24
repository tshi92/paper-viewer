import { describe, expect, it } from "vitest";
import { isReadingState, readingStates } from "../src/paper-status";

describe("paper status", () => {
  it("contains the Phase 1 reading states", () => {
    expect(readingStates).toEqual(["new", "reading", "saved", "discussed", "skipped", "archived"]);
  });

  it("validates reading states", () => {
    expect(isReadingState("reading")).toBe(true);
    expect(isReadingState("invalid")).toBe(false);
  });
});
