import { describe, expect, it } from "vitest";
import { backfillPatches, isNoop, parseAssignments, parseResearchersFile, planSync } from "./researcher-sync";
import { monthKey, windowStart } from "./researchers";

const paper = {
  arxiv_id: "2609.27040", title: " EMA ", abstract: "a", authors: ["Yi Xu", "Ion Stoica"],
  published: "2026-09-22", primary_category: "cs.DC", position: 2, attribution: "name"
};
const ion = { slug: "ion-stoica", name: "Ion Stoica", affiliation: "UC Berkeley", known_for: "Spark", papers: [paper] };
const file = (researchers: unknown[]) => ({ schema: 1, generated: "2026-09-28", researchers });

describe("parseResearchersFile", () => {
  it("normalizes researchers and papers and drops the fields the page does not use", () => {
    const parsed = parseResearchersFile(file([ion]));
    expect(parsed.researchers).toEqual([{
      slug: "ion-stoica", name: "Ion Stoica", affiliation: "UC Berkeley", knownFor: "Spark",
      papers: [{ arxivId: "2609.27040", title: "EMA", abstract: "a", authors: ["Yi Xu", "Ion Stoica"], published: "2026-09-22", position: 2 }]
    }]);
    expect(parsed.skippedPapers).toBe(0);
  });

  it("skips malformed papers instead of failing the file", () => {
    const bad = [
      { ...paper, arxiv_id: "not-an-id" }, { ...paper, title: "" }, { ...paper, authors: [] },
      { ...paper, position: 0 }, { ...paper, position: 3 }, { ...paper, published: "Sept 22" }
    ];
    const parsed = parseResearchersFile(file([{ ...ion, papers: [paper, ...bad] }]));
    expect(parsed.researchers[0]!.papers).toHaveLength(1);
    expect(parsed.skippedPapers).toBe(6);
  });

  it("rejects a file that would deactivate or misname researchers", () => {
    expect(() => parseResearchersFile({ ...file([ion]), schema: 2 })).toThrow(/schema/);
    expect(() => parseResearchersFile(file([]))).toThrow(/no researchers/);
    expect(() => parseResearchersFile(file([{ ...ion, slug: "Bad Slug" }]))).toThrow(/researcher entry/);
    expect(() => parseResearchersFile(file([{ ...ion, name: "" }]))).toThrow(/researcher entry/);
    expect(() => parseResearchersFile(file([ion, ion]))).toThrow(/duplicate/);
  });
});

describe("planSync", () => {
  const parsed = parseResearchersFile(file([ion]));
  const stored = [{ slug: "ion-stoica", name: "Ion Stoica", affiliation: "UC Berkeley", knownFor: "Spark", active: true }];
  const linked = [{ researcherSlug: "ion-stoica", paperId: "p1", arxivId: "2609.27040", position: 2 }];

  it("is a no-op when every paper is linked and nothing changed", () => {
    expect(isNoop(planSync(parsed, stored, linked))).toBe(true);
  });

  it("links new papers and upserts changed or returning researchers", () => {
    const plan = planSync(parsed, [{ ...stored[0]!, affiliation: "Berkeley", active: false }], []);
    expect(plan.upserts.map((r) => r.slug)).toEqual(["ion-stoica"]);
    expect(plan.newLinks.map((l) => l.paper.arxivId)).toEqual(["2609.27040"]);
  });

  it("deactivates researchers missing from the file and follows a corrected position", () => {
    const gone = { slug: "gone", name: "Gone", affiliation: "", knownFor: "", active: true };
    const plan = planSync(parsed, [...stored, gone], [{ ...linked[0]!, position: 1 }]);
    expect(plan.deactivate).toEqual(["gone"]);
    expect(plan.moved).toEqual([{ slug: "ion-stoica", paperId: "p1", position: 2 }]);
  });

  it("keeps papers that rolled out of the file: the database is the archive", () => {
    const archived = { researcherSlug: "ion-stoica", paperId: "p0", arxivId: "2605.00001", position: 1 };
    expect(isNoop(planSync(parsed, stored, [...linked, archived]))).toBe(true);
  });

  it("keeps a listed researcher with no recent papers active", () => {
    const quiet = parseResearchersFile(file([{ ...ion, papers: [] }]));
    expect(isNoop(planSync(quiet, stored, linked))).toBe(true);
  });
});

describe("backfillPatches", () => {
  const feed = parseResearchersFile(file([ion])).researchers[0]!.papers;

  it("fills only the fields a conference-owned row left empty", () => {
    const patches = backfillPatches(feed, [{ id: "conf", arxivId: "2609.27040", abstract: null, publishedAt: null }]);
    expect(patches.get("conf")).toEqual({ abstract: "a", publishedAt: new Date("2026-09-22T00:00:00Z") });
  });

  it("leaves complete rows alone", () => {
    const row = { id: "arx", arxivId: "2609.27040", abstract: "kept", publishedAt: new Date("2026-09-21T00:00:00Z") };
    expect(backfillPatches(feed, [row]).size).toBe(0);
  });
});

describe("parseAssignments", () => {
  it("gives every paper of the batch a direction, other when skipped or unknown", () => {
    const out = parseAssignments(
      { assignments: [{ id: "a", direction: "llm-serving" }, { id: "b", direction: "made-up" }, { id: "zzz", direction: "llm-serving" }] },
      ["a", "b", "c"]
    );
    expect(out).toEqual(new Map([["a", "llm-serving"], ["b", "other"], ["c", "other"]]));
  });

  it("throws on an answer without a list, so the batch is retried rather than filed as other", () => {
    expect(() => parseAssignments({}, ["a"])).toThrow(SyntaxError);
  });
});

describe("window helpers", () => {
  it("start the window at UTC midnight 91 days back and key the month by its 1st", () => {
    const now = new Date("2026-09-28T15:30:00Z");
    expect(windowStart(now).toISOString()).toBe("2026-06-29T00:00:00.000Z");
    expect(monthKey(now).toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });
});
