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

export function canDeleteComment(role: WorkspaceRole | null, isAuthor: boolean): boolean {
  return canDeleteAnnotation(role, isAuthor);
}
