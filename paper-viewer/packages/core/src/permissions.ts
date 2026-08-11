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

export function canManageLabels(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin";
}

export function canDeleteAnnotation(role: WorkspaceRole | null, isAuthor: boolean): boolean {
  if (isAuthor) return role !== null;
  return role === "owner" || role === "admin";
}

export function canDeleteComment(role: WorkspaceRole | null, isAuthor: boolean): boolean {
  return canDeleteAnnotation(role, isAuthor);
}
