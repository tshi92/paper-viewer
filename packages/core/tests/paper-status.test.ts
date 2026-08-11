import { describe, expect, it } from "vitest";
import { isReadingState, readingStates } from "../src/paper-status";

describe("paper status", () => {
  it("contains the four team-workflow reading states", () => {
    expect(readingStates).toEqual(["new", "reading", "discussed", "skipped"]);
  });

  it("validates reading states", () => {
    expect(isReadingState("reading")).toBe(true);
    expect(isReadingState("invalid")).toBe(false);
  });

  it("rejects the retired saved and archived states", () => {
    expect(isReadingState("saved")).toBe(false);
    expect(isReadingState("archived")).toBe(false);
  });
});
