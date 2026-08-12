export type WorkspaceRole = "owner" | "admin" | "member";

export function canReadWorkspace(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

export function canWritePaper(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin" || role === "member";
}

export function canManageWorkspace(role: WorkspaceRole | null): boolean {
  return role === "owner";
}

export function canManageWorkspaceSettings(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin";
}

/** Authors alone may delete their annotations; admins and owners may not delete other people's. */
export function canDeleteAnnotation(role: WorkspaceRole | null, isAuthor: boolean): boolean {
  return isAuthor && role !== null;
}

/**
 * Comments diverge from annotations on purpose: the author manages their own,
 * and admins/owners may moderate anyone's (edit and delete alike).
 */
export function canModifyComment(role: WorkspaceRole | null, isAuthor: boolean): boolean {
  if (role === null) {
    return false;
  }
  return isAuthor || role === "admin" || role === "owner";
}
