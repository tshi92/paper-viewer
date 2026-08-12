import { describe, expect, it } from "vitest";
import { extractPdfOutline, type OutlineCapableDocument, type RawOutlineNode } from "./pdf-outline";

function doc(roots: RawOutlineNode[] | null, pages: Record<string, number> = {}): OutlineCapableDocument {
  return {
    getOutline: async () => roots,
    getDestination: async (id) => (id in pages ? [{ ref: id }] : null),
    getPageIndex: async (ref) => {
      const id = (ref as { ref?: string }).ref;
      if (!id || !(id in pages)) throw new Error("dangling ref");
      return pages[id]!;
    }
  };
}

describe("extractPdfOutline", () => {
  it("flattens two levels with resolved 1-based pages", async () => {
    const outline = await extractPdfOutline(
      doc(
        [
          {
            title: "1 Introduction",
            dest: "intro",
            items: [{ title: "1.1 Motivation", dest: "motivation", items: [] }]
          },
          { title: "2 Design", dest: "design", items: [] }
        ],
        { intro: 0, motivation: 1, design: 3 }
      )
    );
    expect(outline).toEqual([
      { title: "1 Introduction", page: 1, level: 0 },
      { title: "1.1 Motivation", page: 2, level: 1 },
      { title: "2 Design", page: 4, level: 0 }
    ]);
  });

  it("ignores depth beyond the cap", async () => {
    const outline = await extractPdfOutline(
      doc(
        [
          {
            title: "1 Top",
            dest: "a",
            items: [
              {
                title: "1.1 Sub",
                dest: "b",
                items: [{ title: "1.1.1 Too deep", dest: "c", items: [] }]
              }
            ]
          }
        ],
        { a: 0, b: 1, c: 2 }
      )
    );
    expect(outline.map((entry) => entry.title)).toEqual(["1 Top", "1.1 Sub"]);
  });

  it("drops nodes with broken destinations instead of failing", async () => {
    const outline = await extractPdfOutline(
      doc(
        [
          { title: "Good", dest: "ok", items: [] },
          { title: "Broken", dest: "missing", items: [] },
          { title: "", dest: "ok", items: [] },
          { title: "Explicit", dest: [{ ref: "ok" }], items: [] }
        ],
        { ok: 5 }
      )
    );
    expect(outline).toEqual([
      { title: "Good", page: 6, level: 0 },
      { title: "Explicit", page: 6, level: 0 }
    ]);
  });

  it("returns [] for documents without an outline", async () => {
    expect(await extractPdfOutline(doc(null))).toEqual([]);
    expect(await extractPdfOutline(doc([]))).toEqual([]);
  });
});
