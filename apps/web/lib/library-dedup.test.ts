import { describe, expect, it } from "vitest";
import { matchDuplicate, type LibraryRow } from "./library-dedup";

function row(paperId: string, paper: Partial<LibraryRow["paper"]> = {}): LibraryRow {
  return {
    paperId,
    paper: { title: "Some Other Paper", doi: null, arxivId: null, ...paper }
  };
}

/**
 * One article, many doors: the digest saves an arXiv row, the conference
 * catalog a bare-metadata row, a member uploads the PDF by hand. The matcher
 * must recognize them as the same paper however identifiers disagree.
 */
describe("matchDuplicate", () => {
  it("matches by DOI", () => {
    const rows = [row("p1", { doi: "10.1145/123" })];
    expect(matchDuplicate(rows, { title: "Entirely Different", doi: "10.1145/123" })).toBe("p1");
  });

  it("matches by arXiv id", () => {
    const rows = [row("p1", { arxivId: "2608.10402" })];
    expect(matchDuplicate(rows, { title: "Entirely Different", arxivId: "2608.10402" })).toBe("p1");
  });

  it("matches by normalized title across case and punctuation", () => {
    const rows = [
      row("p1", { title: "ECHO: Efficient KV Cache Offloading with Lossless Prefetching" })
    ];
    expect(
      matchDuplicate(rows, {
        title: "echo — efficient kv cache offloading, with lossless prefetching"
      })
    ).toBe("p1");
  });

  it("does not match an empty title against anything", () => {
    const rows = [row("p1", { title: "…" })];
    expect(matchDuplicate(rows, { title: "" })).toBeNull();
  });

  it("returns null when nothing matches", () => {
    const rows = [row("p1", { title: "A", arxivId: "1111.0001", doi: "10.1/x" })];
    expect(matchDuplicate(rows, { title: "B", arxivId: "2222.0002", doi: "10.2/y" })).toBeNull();
  });
});
