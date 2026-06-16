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
