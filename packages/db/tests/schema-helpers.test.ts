import { describe, expect, it } from "vitest";
import { normalizePaperIdentity } from "../src/schema-helpers";

describe("normalizePaperIdentity", () => {
  it("normalizes arXiv identifiers and DOI values", () => {
    expect(normalizePaperIdentity({ arxivId: " arXiv:2401.00001 ", doi: " 10.1000/ABC " })).toEqual({
      arxivId: "2401.00001",
      doi: "10.1000/abc"
    });
  });

  it("keeps missing identifiers as null", () => {
    expect(normalizePaperIdentity({ arxivId: "" })).toEqual({
      arxivId: null,
      doi: null
    });
  });
});
