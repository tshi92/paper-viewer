export type WorkspaceRole = "owner" | "admin" | "member";

export function canManageWorkspaceSettings(role: WorkspaceRole | null): boolean {
  return role === "owner" || role === "admin";
}

/**
 * Saving a paper into the shared library and taking it back out are both open
 * to every member: a reading list is curated by the people reading it, and
 * removal only archives the row — annotations, comments and reading state
 * survive, so the action is recoverable rather than destructive. What the check
 * still enforces is membership: someone outside the workspace has no say over
 * its library.
 */
export function canRemovePaper(role: WorkspaceRole | null): boolean {
  return role !== null;
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
