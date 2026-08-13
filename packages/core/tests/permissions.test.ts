import { describe, expect, it } from "vitest";
import {
  canDeleteAnnotation,
  canModifyComment,
  canManageWorkspaceSettings,
  canRemovePaper
} from "../src/permissions";

describe("permissions", () => {
  it("allows owner and admin to manage workspace settings, not members", () => {
    expect(canManageWorkspaceSettings("owner")).toBe(true);
    expect(canManageWorkspaceSettings("admin")).toBe(true);
    expect(canManageWorkspaceSettings("member")).toBe(false);
    expect(canManageWorkspaceSettings(null)).toBe(false);
  });

  it("lets any member remove a paper from the shared library, but no outsider", () => {
    expect(canRemovePaper("owner")).toBe(true);
    expect(canRemovePaper("admin")).toBe(true);
    expect(canRemovePaper("member")).toBe(true);
    expect(canRemovePaper(null)).toBe(false);
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
    expect(canModifyComment(null, true)).toBe(false);
  });

  it("lets comment authors and admins modify, plain members only their own", () => {
    expect(canModifyComment("member", true)).toBe(true);
    expect(canModifyComment("member", false)).toBe(false);
    expect(canModifyComment("admin", false)).toBe(true);
    expect(canModifyComment("owner", false)).toBe(true);
    expect(canModifyComment("admin", true)).toBe(true);
  });
});
