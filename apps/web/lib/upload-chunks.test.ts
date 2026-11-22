import { describe, expect, it } from "vitest";
import { isUploadId, partIndex, partPathname, partRanges, UPLOAD_PART_BYTES } from "./upload-chunks";

describe("splitting a file into parts", () => {
  it("keeps every part under the host's request body limit", () => {
    const fileBytes = 13_489_346;
    const ranges = partRanges(fileBytes);
    expect(ranges.every((range) => range.end - range.start <= UPLOAD_PART_BYTES)).toBe(true);
    expect(UPLOAD_PART_BYTES).toBeLessThan(4_500_000);
  });

  it("covers the whole file with no gap or overlap", () => {
    const fileBytes = UPLOAD_PART_BYTES * 2 + 17;
    expect(partRanges(fileBytes)).toEqual([
      { start: 0, end: UPLOAD_PART_BYTES },
      { start: UPLOAD_PART_BYTES, end: UPLOAD_PART_BYTES * 2 },
      { start: UPLOAD_PART_BYTES * 2, end: fileBytes }
    ]);
  });

  it("does not add an empty trailing part when the size is an exact multiple", () => {
    expect(partRanges(UPLOAD_PART_BYTES * 2)).toHaveLength(2);
  });
});

describe("naming parts", () => {
  const uploadId = "3f2b8c1e-9a4d-4e6f-8b1a-2c3d4e5f6a7b";

  it("reads back the index it wrote into the pathname", () => {
    expect(partIndex(partPathname("user-1", uploadId, 11))).toBe(11);
  });

  it("ignores a blob that is not named like a part", () => {
    expect(partIndex(`uploads/user-1/${uploadId}/notes.txt`)).toBeNull();
  });

  it("accepts only a UUID as an upload id, so it cannot reach outside its folder", () => {
    expect(isUploadId(uploadId)).toBe(true);
    expect(isUploadId("../other-user/x")).toBe(false);
    expect(isUploadId("")).toBe(false);
  });
});
