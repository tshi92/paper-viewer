import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
const del = vi.fn();
const put = vi.fn();
const getEnv = vi.fn();
const fetchMock = vi.fn();

vi.mock("@vercel/blob", () => ({ list, del, put }));
vi.mock("@/lib/env", () => ({ getEnv, getS3Config: () => null }));

const { assembleUpload, pruneAbandonedParts } = await import("./upload-parts");

const USER = "user-1";
const UPLOAD = "3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b";
const NOW = new Date("2026-11-22T20:00:00Z");

function part(index: number, content: string, uploadedHoursAgo = 0) {
  const pathname = `uploads/${USER}/${UPLOAD}/${String(index).padStart(4, "0")}`;
  return {
    url: `https://store.example/${pathname}`,
    pathname,
    size: content.length,
    uploadedAt: new Date(NOW.getTime() - uploadedHoursAgo * 3_600_000),
    content
  };
}

function storeHolds(parts: ReturnType<typeof part>[]) {
  list.mockResolvedValue({ blobs: parts, hasMore: false });
  fetchMock.mockImplementation(async (url: string) => {
    const found = parts.find((candidate) => candidate.url === url);
    return found ? new Response(found.content) : new Response("missing", { status: 404 });
  });
}

const textOf = (bytes: Uint8Array) => Buffer.from(bytes).toString("utf8");

beforeEach(() => {
  getEnv.mockReturnValue({ BLOB_READ_WRITE_TOKEN: "blob-token" });
  del.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("assembling an upload from its parts", () => {
  it("joins the parts in index order, whatever order the store lists them in", async () => {
    storeHolds([part(2, "cc"), part(0, "%PDF-aa"), part(1, "bb")]);
    const result = await assembleUpload({ userId: USER, uploadId: UPLOAD, expectedParts: 3, maxBytes: 100 });
    expect(result.ok && textOf(result.bytes)).toBe("%PDF-aabbcc");
  });

  it("refuses an upload with a part missing instead of storing a truncated PDF", async () => {
    storeHolds([part(0, "%PDF-aa"), part(2, "cc")]);
    const result = await assembleUpload({ userId: USER, uploadId: UPLOAD, expectedParts: 3, maxBytes: 100 });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an upload over the size limit before downloading any part", async () => {
    storeHolds([part(0, "%PDF-aaaa"), part(1, "bbbbbbbb")]);
    const result = await assembleUpload({ userId: USER, uploadId: UPLOAD, expectedParts: 2, maxBytes: 10 });
    expect(result).toEqual({ ok: false, reason: "PDF exceeds the configured size limit." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only looks inside the uploading user's own folder", async () => {
    storeHolds([part(0, "%PDF-aa")]);
    await assembleUpload({ userId: USER, uploadId: UPLOAD, expectedParts: 1, maxBytes: 100 });
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ prefix: `uploads/${USER}/${UPLOAD}/` }));
  });

  it("deletes the parts once they are joined", async () => {
    const parts = [part(0, "%PDF-aa"), part(1, "bb")];
    storeHolds(parts);
    await assembleUpload({ userId: USER, uploadId: UPLOAD, expectedParts: 2, maxBytes: 100 });
    expect(del).toHaveBeenCalledWith(
      parts.map((blob) => blob.url),
      expect.anything()
    );
  });

  it("still returns the PDF when deleting the parts fails", async () => {
    storeHolds([part(0, "%PDF-aa")]);
    del.mockRejectedValueOnce(new Error("rate limited"));
    const result = await assembleUpload({ userId: USER, uploadId: UPLOAD, expectedParts: 1, maxBytes: 100 });
    expect(result.ok).toBe(true);
  });
});

describe("pruning abandoned parts", () => {
  it("does nothing without a Blob store", async () => {
    getEnv.mockReturnValue({});
    await expect(pruneAbandonedParts(NOW)).resolves.toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("deletes parts left over from an upload that never finished, and spares one in progress", async () => {
    const abandoned = part(0, "old", 30);
    const inProgress = part(1, "new", 1);
    list.mockResolvedValue({ blobs: [abandoned, inProgress], hasMore: false });
    await expect(pruneAbandonedParts(NOW)).resolves.toBe(1);
    expect(del).toHaveBeenCalledWith([abandoned.url], expect.anything());
  });
});
