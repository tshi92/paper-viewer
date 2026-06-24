import { describe, expect, it } from "vitest";
import { canManageWorkspace, canReadWorkspace, canWritePaper } from "../src/permissions";

describe("permissions", () => {
  it("allows owners to manage the workspace", () => {
    expect(canManageWorkspace("owner")).toBe(true);
    expect(canManageWorkspace("admin")).toBe(false);
    expect(canManageWorkspace("member")).toBe(false);
  });

  it("allows all workspace roles to read and write paper collaboration data", () => {
    expect(canReadWorkspace("owner")).toBe(true);
    expect(canReadWorkspace("admin")).toBe(true);
    expect(canReadWorkspace("member")).toBe(true);
    expect(canWritePaper("owner")).toBe(true);
    expect(canWritePaper("admin")).toBe(true);
    expect(canWritePaper("member")).toBe(true);
  });

  it("rejects missing membership", () => {
    expect(canReadWorkspace(null)).toBe(false);
    expect(canWritePaper(null)).toBe(false);
    expect(canManageWorkspace(null)).toBe(false);
  });
});
