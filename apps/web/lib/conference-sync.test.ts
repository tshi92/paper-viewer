import { describe, expect, it } from "vitest";
import { conferenceSourceId, parseConferenceFeed } from "./conference-sync";
import { normalizeTitle } from "./paper-identity";

describe("parseConferenceFeed", () => {
  it("accepts a bare array and normalizes fields", () => {
    const { entries, skipped } = parseConferenceFeed([
      {
        venue: "sosp",
        year: "2025",
        title: "  Fast Storage  ",
        authors: "Ada Lovelace; Grace Hopper and Alan Turing",
        pdf: "https://example.org/fast.pdf"
      }
    ]);
    expect(skipped).toBe(0);
    expect(entries).toEqual([
      {
        venue: "SOSP",
        year: 2025,
        title: "Fast Storage",
        authors: ["Ada Lovelace", "Grace Hopper", "Alan Turing"],
        abstract: null,
        pdfUrl: "https://example.org/fast.pdf",
        doi: null,
        arxivId: null
      }
    ]);
  });

  it("accepts the { papers: [...] } wrapper and array authors", () => {
    const { entries } = parseConferenceFeed({
      papers: [{ conference: "OSDI", year: 2024, title: "T", authors: ["A", " ", "B"] }]
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.venue).toBe("OSDI");
    expect(entries[0]!.authors).toEqual(["A", "B"]);
  });

  it("counts entries missing venue, year, or title as skipped instead of failing", () => {
    const { entries, skipped } = parseConferenceFeed([
      { venue: "SOSP", year: 2025, title: "Kept" },
      { venue: "", year: 2025, title: "No venue" },
      { venue: "OSDI", year: "not-a-year", title: "No year" },
      { venue: "OSDI", year: 2024 },
      null
    ]);
    expect(entries.map((entry) => entry.title)).toEqual(["Kept"]);
    expect(skipped).toBe(4);
  });

  it("rejects a feed that is not a list at all", () => {
    expect(() => parseConferenceFeed({ nope: true })).toThrow(/JSON array/);
  });
});

describe("conferenceSourceId", () => {
  it("is deterministic and slug-safe", () => {
    const id = conferenceSourceId({ venue: "SOSP", year: 2025, title: "Nereus: Fast RDMA!" });
    expect(id).toBe("sosp-2025-nereus-fast-rdma");
    expect(conferenceSourceId({ venue: "SOSP", year: 2025, title: "Nereus: Fast RDMA!" })).toBe(id);
  });
});

describe("normalizeTitle", () => {
  it("treats punctuation and case variants as the same article", () => {
    expect(normalizeTitle("Nereus: Fast RDMA-based Storage")).toBe(
      normalizeTitle("  nereus — fast RDMA based storage ")
    );
  });

  it("keeps genuinely different titles apart", () => {
    expect(normalizeTitle("Paper One")).not.toBe(normalizeTitle("Paper Two"));
  });
});
