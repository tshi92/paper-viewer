import { describe, expect, it } from "vitest";
import {
  canDeleteAnnotation,
  canDeleteComment,
  canManageWorkspace,
  canManageWorkspaceSettings,
  canReadWorkspace,
  canWritePaper
} from "../src/permissions";

describe("permissions", () => {
  it("allows owners to manage the workspace", () => {
    expect(canManageWorkspace("owner")).toBe(true);
    expect(canManageWorkspace("admin")).toBe(false);
    expect(canManageWorkspace("member")).toBe(false);
  });

  it("allows owner and admin to manage workspace settings, not members", () => {
    expect(canManageWorkspaceSettings("owner")).toBe(true);
    expect(canManageWorkspaceSettings("admin")).toBe(true);
    expect(canManageWorkspaceSettings("member")).toBe(false);
    expect(canManageWorkspaceSettings(null)).toBe(false);
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

  it("lets only the author delete an annotation, whatever the role", () => {
    expect(canDeleteAnnotation("member", true)).toBe(true);
    expect(canDeleteAnnotation("admin", true)).toBe(true);
    expect(canDeleteAnnotation("owner", true)).toBe(true);
    expect(canDeleteAnnotation("member", false)).toBe(false);
    expect(canDeleteAnnotation("admin", false)).toBe(false);
    expect(canDeleteAnnotation("owner", false)).toBe(false);
    expect(canDeleteAnnotation(null, false)).toBe(false);
  });

  it("rejects an author who is no longer a workspace member", () => {
    expect(canDeleteAnnotation(null, true)).toBe(false);
    expect(canDeleteComment(null, true)).toBe(false);
  });

  it("applies the same author-only policy to comments", () => {
    expect(canDeleteComment("member", true)).toBe(true);
    expect(canDeleteComment("member", false)).toBe(false);
    expect(canDeleteComment("admin", false)).toBe(false);
    expect(canDeleteComment("owner", false)).toBe(false);
  });
});
