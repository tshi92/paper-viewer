import { describe, expect, it } from "vitest";
import { compareConferenceRefs, paperSource, sourceFilterKey } from "./paper-source";

describe("paperSource", () => {
  it("names the venue and year instead of the literal 'conference'", () => {
    expect(
      paperSource({ source: "conference", conferenceEntries: [{ venue: "SOSP", year: 2026 }] })
    ).toEqual({ kind: "conference", venue: "SOSP", year: 2026 });
  });

  it("prefers the conference over arXiv for a matched preprint", () => {
    // Identity resolution links an arXiv preprint to its accepted paper; the
    // venue is the more useful of the two facts, and the arXiv id is on the row.
    expect(
      paperSource({ source: "arxiv", conferenceEntries: [{ venue: "OSDI", year: 2025 }] })
    ).toEqual({ kind: "conference", venue: "OSDI", year: 2025 });
  });

  it("takes the most recent edition when a paper is listed in several", () => {
    expect(
      paperSource({
        source: "conference",
        conferenceEntries: [
          { venue: "HotOS", year: 2023 },
          { venue: "SOSP", year: 2026 }
        ]
      })
    ).toEqual({ kind: "conference", venue: "SOSP", year: 2026 });
  });

  it("folds hermes into arXiv and passes unknown sources through", () => {
    expect(paperSource({ source: "arxiv" })).toEqual({ kind: "arxiv" });
    expect(paperSource({ source: "hermes" })).toEqual({ kind: "arxiv" });
    expect(paperSource({ source: "manual", conferenceEntries: [] })).toEqual({ kind: "manual" });
    expect(paperSource({ source: "zenodo" })).toEqual({ kind: "other", source: "zenodo" });
  });
});

describe("sourceFilterKey", () => {
  it("keeps each conference edition a separate filter option", () => {
    const sosp26 = sourceFilterKey(paperSource({ source: "conference", conferenceEntries: [{ venue: "SOSP", year: 2026 }] }));
    const sosp25 = sourceFilterKey(paperSource({ source: "conference", conferenceEntries: [{ venue: "SOSP", year: 2025 }] }));
    const osdi26 = sourceFilterKey(paperSource({ source: "conference", conferenceEntries: [{ venue: "OSDI", year: 2026 }] }));
    expect(new Set([sosp26, sosp25, osdi26]).size).toBe(3);
  });

  it("gives the same paper the same key on the row and in the dropdown", () => {
    const paper = { source: "arxiv", conferenceEntries: [] };
    expect(sourceFilterKey(paperSource(paper))).toBe("arxiv");
    expect(sourceFilterKey(paperSource({ source: "manual" }))).toBe("manual");
    expect(sourceFilterKey(paperSource({ source: "zenodo" }))).toBe("src:zenodo");
  });
});

describe("compareConferenceRefs", () => {
  it("sorts newest edition first, then venue alphabetically", () => {
    const sorted = [
      { venue: "SOSP", year: 2025 },
      { venue: "OSDI", year: 2026 },
      { venue: "ASPLOS", year: 2026 }
    ].sort(compareConferenceRefs);
    expect(sorted).toEqual([
      { venue: "ASPLOS", year: 2026 },
      { venue: "OSDI", year: 2026 },
      { venue: "SOSP", year: 2025 }
    ]);
  });
});
