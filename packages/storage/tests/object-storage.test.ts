import { describe, expect, it } from "vitest";
import * as storage from "@paper-viewer/storage";

describe("storage scaffold", () => {
  it("imports the storage entrypoint", () => {
    expect(storage).toBeTypeOf("object");
  });
});
