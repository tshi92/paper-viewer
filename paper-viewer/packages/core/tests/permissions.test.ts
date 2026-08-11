import { describe, expect, it } from "vitest";
import {
  canDeleteAnnotation,
  canDeleteComment,
  canManageLabels,
  canManageWorkspace,
  canReadWorkspace,
  canWritePaper
} from "../src/permissions";

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

  it("allows owner and admin to manage labels, not members", () => {
    expect(canManageLabels("owner")).toBe(true);
    expect(canManageLabels("admin")).toBe(true);
    expect(canManageLabels("member")).toBe(false);
    expect(canManageLabels(null)).toBe(false);
  });

  it("lets authors delete their own annotations and admins delete anyone's", () => {
    expect(canDeleteAnnotation("member", true)).toBe(true);
    expect(canDeleteAnnotation("member", false)).toBe(false);
    expect(canDeleteAnnotation("admin", false)).toBe(true);
    expect(canDeleteAnnotation("owner", false)).toBe(true);
    expect(canDeleteAnnotation(null, false)).toBe(false);
  });

  it("applies the same policy to comments", () => {
    expect(canDeleteComment("member", true)).toBe(true);
    expect(canDeleteComment("member", false)).toBe(false);
    expect(canDeleteComment("admin", false)).toBe(true);
  });
});
