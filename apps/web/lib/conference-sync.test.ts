import { describe, expect, it } from "vitest";
import { conferenceSourceId, parseConferenceFeed, parseGithubRepo } from "./conference-sync";
import { normalizeTitle } from "./paper-identity";

describe("parseConferenceFeed", () => {
  it("parses the csconf-papers file shape: { meta, papers } with DBLP author objects", () => {
    const { entries, skipped } = parseConferenceFeed({
      meta: { venue: "SOSP", year: 2026, paper_count: 2 },
      papers: [
        {
          title: "Faithful LLM Training Emulation",
          authors: [{ name: "Ada Lovelace", pid: null }, { name: "Grace Hopper", pid: "x/1" }],
          venue: "SOSP",
          year: 2026,
          doi: null,
          url: null
        },
        {
          // Missing per-item venue/year falls back to the file meta.
          title: "Meta Fallback Paper",
          authors: []
        }
      ]
    });
    expect(skipped).toBe(0);
    expect(entries[0]).toMatchObject({
      venue: "SOSP",
      year: 2026,
      title: "Faithful LLM Training Emulation",
      authors: ["Ada Lovelace", "Grace Hopper"]
    });
    expect(entries[1]).toMatchObject({ venue: "SOSP", year: 2026, title: "Meta Fallback Paper" });
  });

  it("still accepts a bare array with string/delimited authors", () => {
    const { entries } = parseConferenceFeed([
      { venue: "osdi", year: "2025", title: " T ", authors: "A; B and C" }
    ]);
    expect(entries).toEqual([
      {
        venue: "OSDI",
        year: 2025,
        title: "T",
        authors: ["A", "B", "C"],
        abstract: null,
        pdfUrl: null,
        doi: null,
        arxivId: null
      }
    ]);
  });

  it("only keeps urls that plainly serve a PDF", () => {
    const { entries } = parseConferenceFeed([
      { venue: "NSDI", year: 2025, title: "P1", url: "https://www.usenix.org/paper.pdf" },
      { venue: "NSDI", year: 2025, title: "P2", url: "https://doi.org/10.1145/nope" },
      { venue: "NSDI", year: 2025, title: "P3", url: "https://x.org/a.pdf?dl=1" }
    ]);
    expect(entries.map((entry) => entry.pdfUrl)).toEqual([
      "https://www.usenix.org/paper.pdf",
      null,
      "https://x.org/a.pdf?dl=1"
    ]);
  });

  it("counts malformed rows as skipped instead of failing the file", () => {
    const { entries, skipped } = parseConferenceFeed({
      meta: { venue: "OSDI" }, // no year in meta either
      papers: [{ title: "No venue year" }, null, { venue: "OSDI", year: 2025, title: "Kept" }]
    });
    expect(entries.map((entry) => entry.title)).toEqual(["Kept"]);
    expect(skipped).toBe(2);
  });

  it("rejects a feed with no list at all", () => {
    expect(() => parseConferenceFeed({ nope: true })).toThrow(/JSON array/);
  });
});

describe("parseGithubRepo", () => {
  it("extracts owner/repo from repo URLs", () => {
    expect(parseGithubRepo("https://github.com/RealZST/csconf-papers")).toEqual({
      owner: "RealZST",
      repo: "csconf-papers"
    });
    expect(parseGithubRepo("https://github.com/a/b.git")).toEqual({ owner: "a", repo: "b" });
    expect(parseGithubRepo("https://github.com/a/b/tree/main/data")).toEqual({ owner: "a", repo: "b" });
  });

  it("rejects non-github URLs", () => {
    expect(parseGithubRepo("https://example.com/a/b")).toBeNull();
  });
});

describe("conferenceSourceId", () => {
  it("is deterministic and slug-safe", () => {
    const id = conferenceSourceId({ venue: "SOSP", year: 2025, title: "Nereus: Fast RDMA!" });
    expect(id).toBe("sosp-2025-nereus-fast-rdma");
  });
});

describe("normalizeTitle", () => {
  it("treats punctuation and case variants as the same article", () => {
    expect(normalizeTitle("Nereus: Fast RDMA-based Storage")).toBe(
      normalizeTitle("  nereus — fast RDMA based storage ")
    );
  });
});
