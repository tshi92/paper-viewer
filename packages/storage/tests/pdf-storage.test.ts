import { describe, expect, it } from "vitest";
import { createPdfObjectKey } from "../src/pdf-storage";

describe("createPdfObjectKey", () => {
  it("creates workspace and paper scoped PDF keys", () => {
    expect(createPdfObjectKey({ workspaceId: "w1", paperId: "p1", sha256: "abc123" })).toBe(
      "workspaces/w1/papers/p1/files/abc123.pdf"
    );
  });
});
