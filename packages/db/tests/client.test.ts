import { describe, expect, it } from "vitest";
import * as db from "@paper-viewer/db";

describe("db scaffold", () => {
  it("exposes the placeholder prisma client", () => {
    expect(db.prisma).toBeDefined();
  });
});
