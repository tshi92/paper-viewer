import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const del = vi.fn();
const findMany = vi.fn();
const updateMany = vi.fn();
const getEnv = vi.fn();

vi.mock("@vercel/blob", () => ({ list, del, put: vi.fn() }));
vi.mock("@paper-viewer/db", () => ({ prisma: { workspacePaper: { findMany }, paper: { updateMany } } }));
vi.mock("@/lib/env", () => ({ getEnv, getS3Config: () => null }));

const { expiredSnapshots, pruneSnapshots } = await import("./pdf-snapshot");

const NOW = new Date("2026-10-12T20:00:00Z");

function snapshot(paperId: string, uploadedDaysAgo: number) {
  return {
    url: `https://store.example/papers/${paperId}/sha.pdf`,
    pathname: `papers/${paperId}/sha.pdf`,
    size: 2_000_000,
    uploadedAt: new Date(NOW.getTime() - uploadedDaysAgo * 86_400_000)
  };
}

const pathsOf = (blobs: { pathname: string }[]) => blobs.map((blob) => blob.pathname);

describe("which snapshots expire", () => {
  it("keeps a saved paper's snapshot however old it is", () => {
    expect(expiredSnapshots([snapshot("saved", 90)], new Set(["saved"]), NOW)).toEqual([]);
  });

  it("keeps an unsaved paper's snapshot for the seven days Today lists it", () => {
    const blobs = [snapshot("this-week", 6), snapshot("last-week", 8)];
    expect(pathsOf(expiredSnapshots(blobs, new Set(), NOW))).toEqual(["papers/last-week/sha.pdf"]);
  });

  it("never touches a blob that is not named like a snapshot", () => {
    const stray = { ...snapshot("x", 30), pathname: "papers/notes.txt" };
    expect(expiredSnapshots([stray], new Set(), NOW)).toEqual([]);
  });
});

describe("pruning the store", () => {
  beforeEach(() => {
    getEnv.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "blob-token" });
    findMany.mockResolvedValue([{ paperId: "saved" }]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing without a Blob store", async () => {
    getEnv.mockReturnValue({});
    await expect(pruneSnapshots(NOW)).resolves.toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("reads every page of the listing", async () => {
    list
      .mockResolvedValueOnce({ blobs: [snapshot("saved", 30)], hasMore: true, cursor: "page-2" })
      .mockResolvedValueOnce({ blobs: [snapshot("unsaved", 30)], hasMore: false });

    await expect(pruneSnapshots(NOW)).resolves.toEqual({ listed: 2, deleted: 1, freedBytes: 2_000_000 });
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "page-2" }));
  });

  it("lets go of the paper's URL before deleting the blob", async () => {
    const expired = snapshot("unsaved", 30);
    list.mockResolvedValue({ blobs: [expired], hasMore: false });

    await pruneSnapshots(NOW);

    expect(updateMany).toHaveBeenCalledWith({ where: { blobUrl: { in: [expired.url] } }, data: { blobUrl: null } });
    expect(del).toHaveBeenCalledWith([expired.url], { token: "blob-token" });
    expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(del.mock.invocationCallOrder[0]!);
  });
});
