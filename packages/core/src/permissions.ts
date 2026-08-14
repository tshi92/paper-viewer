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

/**
 * Deleting an annotation follows the same rule as deleting a comment: the
 * author manages their own, and admins/owners may moderate anyone's. Both mark
 * up shared reading material, so the same people need to be able to clean up
 * after a mistake or a departed member.
 *
 * Editing stays author-only (see the PATCH route): an annotation's labels are
 * the author's reading of the passage, not a moderation surface.
 */
export function canDeleteAnnotation(role: WorkspaceRole | null, isAuthor: boolean): boolean {
  if (role === null) {
    return false;
  }
  return isAuthor || role === "admin" || role === "owner";
}

/**
 * The author manages their own comments, and admins/owners may moderate
 * anyone's (edit and delete alike).
 */
export function canModifyComment(role: WorkspaceRole | null, isAuthor: boolean): boolean {
  if (role === null) {
    return false;
  }
  return isAuthor || role === "admin" || role === "owner";
}
