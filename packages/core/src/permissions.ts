export type WorkspaceRole = "owner" | "admin" | "member";

export function canManageWorkspaceSettings(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Removing a paper archives it for the whole workspace, taking it out of
 * everyone's library — so it is an admin action, not something a member can do
 * to a shared reading list. (Reading state, annotations and comments stay
 * per-user and remain writable by every member.)
 */
export function canRemovePaper(role: WorkspaceRole | null): boolean {
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
