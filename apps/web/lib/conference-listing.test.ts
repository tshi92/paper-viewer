import { afterEach, describe, expect, it, vi } from "vitest";
import { listDataFiles, paperCountOf, parseCatalogManifest } from "./conference-sync";

/**
 * How the catalog sync learns which files exist.
 *
 * This used to ask jsDelivr's package-listing API, whose branch listing is a
 * snapshot frozen at the day the source repo was created. It reported 14 files
 * while the repo shipped 20, so three new venues and a whole edition went
 * missing for days while every sync reported success. The tests below pin the
 * two properties that failure needed: the listing comes from a source that
 * follows the branch, and a run that had to fall back says so.
 */
const MANIFEST = {
  schema: 1,
  generated: "2026-08-20",
  paper_count: 2819,
  files: [
    { path: "data/2025/ASPLOS.json", venue: "ASPLOS", year: 2025, paper_count: 179, sha256: "a".repeat(64) },
    { path: "data/2026/MLSys.json", venue: "MLSys", year: 2026, paper_count: 135, sha256: "b".repeat(64) }
  ]
};

const RAW_URL = "https://raw.githubusercontent.com/o/r/main/data/index.json";
const MIRROR_URL = "https://cdn.jsdelivr.net/gh/o/r@main/data/index.json";

describe("parseCatalogManifest", () => {
  it("reads paths, counts and checksums", () => {
    const listing = parseCatalogManifest(MANIFEST);
    expect(listing.totalPaperCount).toBe(2819);
    expect(listing.files.map((file) => file.path)).toEqual([
      "data/2025/ASPLOS.json",
      "data/2026/MLSys.json"
    ]);
    expect(listing.files[0]).toMatchObject({ paperCount: 179, sha256: "a".repeat(64) });
  });

  // The path is templated straight into a fetch URL, so a manifest entry is not
  // taken on trust: the source repo's own caches live at data/ root, and an
  // escaping path must not be able to redirect the sync.
  it("drops anything that is not a venue-year data file", () => {
    const listing = parseCatalogManifest({
      files: [
        { path: "data/link-cache.json", paper_count: 1 },
        { path: "data/index.json", paper_count: 1 },
        { path: "../../etc/passwd", paper_count: 1 },
        { path: "data/2026/OSDI.json", paper_count: 136 }
      ]
    });
    expect(listing.files.map((file) => file.path)).toEqual(["data/2026/OSDI.json"]);
  });

  it("refuses a manifest that lists nothing usable, rather than importing zero files", () => {
    expect(() => parseCatalogManifest({ files: [{ path: "data/pdf-cache.json" }] })).toThrow();
    expect(() => parseCatalogManifest({ nope: true })).toThrow();
  });
});

describe("paperCountOf", () => {
  it("counts the papers array, and a bare array feed", () => {
    expect(paperCountOf({ meta: {}, papers: [1, 2, 3] })).toBe(3);
    expect(paperCountOf([1, 2])).toBe(2);
    expect(paperCountOf({ meta: {} })).toBe(0);
  });
});

describe("listDataFiles", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Answers the given URLs; anything else is a network error. */
  function stubFetch(routes: Record<string, unknown>) {
    const seen: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      seen.push(url);
      if (!(url in routes)) throw new Error(`no route for ${url}`);
      const body = routes[url];
      if (body === "404") return new Response("Not Found", { status: 404 });
      return new Response(JSON.stringify(body), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return seen;
  }

  it("reads the manifest and reports an undegraded run", async () => {
    const seen = stubFetch({ [RAW_URL]: MANIFEST });
    const listing = await listDataFiles("o", "r");

    expect(listing.tier).toBe("manifest");
    expect(listing.files).toHaveLength(2);
    expect(listing.totalPaperCount).toBe(2819);
    expect(seen).toEqual([RAW_URL]);
  });

  // jsDelivr's file CDN is a different subsystem from its listing API and does
  // follow the branch, so the same manifest over a second CDN is genuine
  // redundancy — but it caches branch refs, so its answer can lag.
  it("falls back to the mirrored manifest and marks the tier", async () => {
    stubFetch({ [RAW_URL]: "404", [MIRROR_URL]: MANIFEST });
    const listing = await listDataFiles("o", "r");

    expect(listing.tier).toBe("manifest-mirror");
    expect(listing.files).toHaveLength(2);
  });

  it("falls back to the GitHub API when no manifest is published", async () => {
    stubFetch({
      [RAW_URL]: "404",
      [MIRROR_URL]: "404",
      "https://api.github.com/repos/o/r/contents/data": [{ type: "dir", name: "2026" }],
      "https://api.github.com/repos/o/r/contents/data/2026": [
        { type: "file", name: "OSDI.json" },
        { type: "file", name: "notes.txt" }
      ]
    });
    const listing = await listDataFiles("o", "r");

    expect(listing.tier).toBe("github-api");
    expect(listing.files).toEqual([{ path: "data/2026/OSDI.json", paperCount: null, sha256: null }]);
    // The API knows paths only, so there is no count to check the import against.
    expect(listing.totalPaperCount).toBeNull();
  });

  // The whole point: never return a partial listing that reads as complete.
  it("fails loudly when every tier is exhausted", async () => {
    stubFetch({ [RAW_URL]: "404", [MIRROR_URL]: "404" });
    await expect(listDataFiles("o", "r")).rejects.toThrow(/Could not list/);
  });

  it("never asks jsDelivr's package-listing API, in any position", async () => {
    const seen = stubFetch({
      [RAW_URL]: "404",
      [MIRROR_URL]: "404",
      "https://api.github.com/repos/o/r/contents/data": [{ type: "dir", name: "2026" }],
      "https://api.github.com/repos/o/r/contents/data/2026": [{ type: "file", name: "OSDI.json" }]
    });
    await listDataFiles("o", "r");

    expect(seen.some((url) => url.includes("data.jsdelivr.com"))).toBe(false);
  });
});
