import { describe, expect, it } from "vitest";
import {
  conferenceSourceId,
  parseConferenceFeed,
  parseGithubRepo,
  sameAuthors,
  staleCatalogEntries,
  surplusCatalogEntries,
  type CatalogEntryRow
} from "./conference-sync";
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
        externalUrl: null,
        doi: null,
        arxivId: null
      }
    ]);
  });

  it("only PDF-serving urls become pdfUrl; every url becomes the source link", () => {
    const { entries } = parseConferenceFeed([
      { venue: "NSDI", year: 2025, title: "P1", url: "https://www.usenix.org/paper.pdf" },
      { venue: "NSDI", year: 2025, title: "P2", url: "https://usenix.org/presentation/du" },
      { venue: "NSDI", year: 2025, title: "P3", doi: "10.1145/abc" }
    ]);
    expect(entries.map((entry) => entry.pdfUrl)).toEqual([
      "https://www.usenix.org/paper.pdf",
      null,
      null
    ]);
    expect(entries.map((entry) => entry.externalUrl)).toEqual([
      "https://www.usenix.org/paper.pdf",
      "https://usenix.org/presentation/du",
      // DOI-only entries still get a canonical home via doi.org.
      "https://doi.org/10.1145/abc"
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

describe("surplusCatalogEntries", () => {
  function entry(
    id: string,
    title: string,
    paper: Partial<CatalogEntryRow["paper"]> = {}
  ): CatalogEntryRow {
    return {
      id,
      paper: { title, arxivId: null, pdfUrl: null, blobUrl: null, externalUrl: null, ...paper }
    };
  }

  it("keeps distinct articles untouched", () => {
    const rows = [entry("e1", "Paper One"), entry("e2", "Paper Two")];
    expect(surplusCatalogEntries(rows)).toEqual([]);
  });

  it("collapses same-title twins, preferring the PDF-capable row", () => {
    // The shape production actually hit: a bare conference shell next to a
    // manually uploaded twin holding the PDF.
    const rows = [
      entry("bare", "ECHO: Efficient KV Cache Offloading"),
      entry("pdf", "ECHO: Efficient KV Cache Offloading", { blobUrl: "https://blob/x.pdf" })
    ];
    expect(surplusCatalogEntries(rows)).toEqual(["bare"]);
  });

  it("matches titles across case and punctuation", () => {
    const rows = [
      entry("a", "Strata: Hierarchical Context Caching"),
      entry("b", "strata — hierarchical context caching", { arxivId: "2609.00001" })
    ];
    expect(surplusCatalogEntries(rows)).toEqual(["a"]);
  });

  it("breaks ties by source link, then keeps the first row", () => {
    const rows = [
      entry("plain", "Same Title"),
      entry("linked", "Same Title", { externalUrl: "https://doi.org/10.1/x" })
    ];
    expect(surplusCatalogEntries(rows)).toEqual(["plain"]);

    const stable = [entry("first", "Same Title"), entry("second", "Same Title")];
    expect(surplusCatalogEntries(stable)).toEqual(["second"]);
  });
});

describe("pdf_url ingestion", () => {
  function feedWith(paper: Record<string, unknown>) {
    return parseConferenceFeed({
      meta: { venue: "OSDI", year: 2026 },
      papers: [{ title: "P", authors: ["A"], ...paper }]
    }).entries[0]!;
  }

  it("accepts a direct .pdf link (USENIX shape)", () => {
    const entry = feedWith({ pdf_url: "https://www.usenix.org/system/files/osdi26-x.pdf" });
    expect(entry.pdfUrl).toBe("https://www.usenix.org/system/files/osdi26-x.pdf");
  });

  it("rejects publisher pdf pages that bot protection blocks server-side", () => {
    const entry = feedWith({
      pdf_url: "https://dl.acm.org/doi/pdf/10.1145/3767295.3803568",
      doi: "10.1145/3767295.3803568"
    });
    expect(entry.pdfUrl).toBeNull();
    // The article is still reachable for humans through the external link.
    expect(entry.externalUrl).toBe("https://doi.org/10.1145/3767295.3803568");
  });

  it("normalizes an arXiv pdf link and derives the arXiv id from it", () => {
    const entry = feedWith({ pdf_url: "https://arxiv.org/pdf/2605.15617v2" });
    expect(entry.pdfUrl).toBe("https://arxiv.org/pdf/2605.15617");
    expect(entry.arxivId).toBe("2605.15617");
  });

  it("still accepts a .pdf `url` when no pdf_url is present (VLDB shape)", () => {
    const entry = feedWith({ url: "https://www.vldb.org/pvldb/vol18/p1-x.pdf" });
    expect(entry.pdfUrl).toBe("https://www.vldb.org/pvldb/vol18/p1-x.pdf");
    expect(entry.externalUrl).toBe("https://www.vldb.org/pvldb/vol18/p1-x.pdf");
  });

  it("an explicit arXiv abs url fills the arXiv id too", () => {
    const entry = feedWith({ url: "https://arxiv.org/abs/2608.10402" });
    expect(entry.arxivId).toBe("2608.10402");
    expect(entry.pdfUrl).toBe("https://arxiv.org/pdf/2608.10402");
  });
});

describe("arxiv_id ingestion", () => {
  it("maps the source repo's arxiv_id field onto the entry", () => {
    const { entries } = parseConferenceFeed({
      meta: { venue: "ASPLOS", year: 2026 },
      papers: [{ title: "P", authors: ["A"], doi: "10.1145/1", arxiv_id: "2607.01234" }]
    });
    expect(entries[0]!.arxivId).toBe("2607.01234");
  });

  it("prefers the explicit field over a derived url id", () => {
    const { entries } = parseConferenceFeed({
      meta: { venue: "ASPLOS", year: 2026 },
      papers: [
        { title: "P", authors: ["A"], arxiv_id: "2607.01234", url: "https://arxiv.org/abs/9999.99999" }
      ]
    });
    expect(entries[0]!.arxivId).toBe("2607.01234");
  });
});

describe("author display names", () => {
  it("renders display_name, which drops DBLP's homonym suffix", () => {
    const { entries } = parseConferenceFeed({
      meta: { venue: "SOSP", year: 2026 },
      papers: [
        {
          title: "P",
          authors: [
            { name: "Li Jiang 0002", display_name: "Li Jiang", pid: "45/4954-2" },
            { name: "Grace Hopper", display_name: "Grace Hopper", pid: "h/GraceHopper" }
          ]
        }
      ]
    });
    expect(entries[0]!.authors).toEqual(["Li Jiang", "Grace Hopper"]);
  });

  it("falls back to name for feeds published before display_name existed", () => {
    const { entries } = parseConferenceFeed({
      meta: { venue: "SOSP", year: 2026 },
      papers: [{ title: "P", authors: [{ name: "Ada Lovelace", pid: null }] }]
    });
    expect(entries[0]!.authors).toEqual(["Ada Lovelace"]);
  });
});

describe("sameAuthors", () => {
  it("treats an identical list as unchanged", () => {
    expect(sameAuthors(["Ada Lovelace", "Grace Hopper"], ["Ada Lovelace", "Grace Hopper"])).toBe(true);
  });

  it("reports the mojibake and homonym-suffix spellings as changed", () => {
    expect(sameAuthors(["Moritz WagenlÃ¤nder"], ["Moritz Wagenländer"])).toBe(false);
    expect(sameAuthors(["Li Jiang 0002"], ["Li Jiang"])).toBe(false);
  });

  it("reports a different length or a non-array as changed", () => {
    expect(sameAuthors(["Ada Lovelace"], ["Ada Lovelace", "Grace Hopper"])).toBe(false);
    expect(sameAuthors(null, ["Ada Lovelace"])).toBe(false);
    expect(sameAuthors("Ada Lovelace", ["Ada Lovelace"])).toBe(false);
  });
});

describe("staleCatalogEntries", () => {
  it("returns the entries whose paper the feed no longer lists", () => {
    const rows = [
      { id: "keep-1", paperId: "p1" },
      { id: "keep-2", paperId: "p2" },
      // A SOSP 2024 paper that the commented-out list wrongly put in 2026.
      { id: "stale", paperId: "p-from-another-edition" }
    ];
    expect(staleCatalogEntries(rows, new Set(["p1", "p2"]))).toEqual(["stale"]);
  });

  it("returns nothing when the feed still lists everything", () => {
    const rows = [{ id: "a", paperId: "p1" }];
    expect(staleCatalogEntries(rows, new Set(["p1", "p2"]))).toEqual([]);
  });
});
