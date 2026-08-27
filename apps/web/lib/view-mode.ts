/**
 * The team/personal view toggle.
 *
 * Everything in a workspace is shared; the personal view narrows what is shown
 * to what involves you — papers you saved, annotations you wrote or joined the
 * discussion on, comment threads you took part in. It is a lens, not a
 * permission: nothing is hidden from the team, and switching back shows it all
 * again. The choice is a cookie so it follows you across pages and sessions
 * until you flip it back.
 *
 * "Involves you" rather than "authored by you", on purpose: your reply alone
 * would have no context, and your question shown without its answers would
 * read as unanswered. A thread is one conversation and is shown or hidden
 * whole.
 */
export const VIEW_MODE_COOKIE = "paper_viewer_view";

export type ViewMode = "team" | "mine";

export function readViewMode(cookieValue: string | undefined): ViewMode {
  return cookieValue === "mine" ? "mine" : "team";
}

type ThreadComment = {
  id: string;
  parentId: string | null;
  author: { id: string };
};

/**
 * Keeps every comment whose thread the user took part in, where a thread is a
 * root comment and all replies under it, however deep. Replies stranded by a
 * deleted parent count as one thread from the break point down, and follow the
 * same rule.
 */
export function filterThreadsByParticipant<C extends ThreadComment>(
  comments: readonly C[],
  userId: string
): C[] {
  const byId = new Map(comments.map((comment) => [comment.id, comment]));

  function rootOf(comment: C): string {
    // The topmost reachable ancestor. When a parent has been deleted, the
    // break point serves as the root: the survivors still form one thread and
    // are shown or hidden together, exactly like an intact one.
    let current = comment;
    while (current.parentId) {
      const parent = byId.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current.id;
  }

  const participatingRoots = new Set(
    comments.filter((comment) => comment.author.id === userId).map(rootOf)
  );
  return comments.filter((comment) => participatingRoots.has(rootOf(comment)));
}

/** Whether an annotation is the user's own or carries their reply. */
export function annotationInvolvesUser(
  annotation: { author: { id: string }; comments: readonly { author: { id: string } }[] },
  userId: string
): boolean {
  return (
    annotation.author.id === userId ||
    annotation.comments.some((comment) => comment.author.id === userId)
  );
}
