"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { canModifyComment, type WorkspaceRole } from "@paper-viewer/core/permissions";
import { CommentBody } from "./comment-body";
import { TimeStamp } from "./time-stamp";

type CommentView = {
  id: string;
  body: string;
  parentId: string | null;
  pageNumber: number | null;
  quotedText: string | null;
  createdAt: Date;
  author: {
    id: string;
    email: string;
    name: string | null;
  };
};

export function CommentPanel({
  paperId,
  comments,
  currentUserId,
  currentUserRole
}: {
  paperId: string;
  comments: CommentView[];
  currentUserId: string;
  currentUserRole: WorkspaceRole;
}) {
  const t = useTranslations("comments");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<"oldest" | "newest">("oldest");
  const [replyTo, setReplyTo] = useState<string | null>(null);

  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const comment of comments) {
      map.set(comment.author.id, comment.author.name ?? comment.author.email);
    }
    return [...map.entries()];
  }, [comments]);

  // Threading: replies (at any depth) render flattened under their thread
  // root, in conversation order, each labeled with @whoever it answers. The
  // server delivers createdAt asc, which keeps that order for free.
  const { byId, threads, descendants } = useMemo(() => {
    const byId = new Map(comments.map((comment) => [comment.id, comment]));
    // Comments whose parent was deleted out from under them become roots
    // rather than disappearing.
    const isRoot = (comment: CommentView) =>
      comment.parentId === null || !byId.has(comment.parentId);

    const descendants = new Map<string, number>();
    const repliesByRoot = new Map<string, CommentView[]>();
    for (const comment of comments) {
      if (isRoot(comment)) continue;
      let cursor = comment;
      // Credit every ancestor (for delete confirmations) and find the root.
      for (let hops = 0; cursor.parentId && byId.has(cursor.parentId) && hops < 100; hops++) {
        cursor = byId.get(cursor.parentId)!;
        descendants.set(cursor.id, (descendants.get(cursor.id) ?? 0) + 1);
      }
      const bucket = repliesByRoot.get(cursor.id) ?? [];
      bucket.push(comment);
      repliesByRoot.set(cursor.id, bucket);
    }

    const threads = comments
      .filter(isRoot)
      .map((root) => ({ root, replies: repliesByRoot.get(root.id) ?? [] }));
    return { byId, threads, descendants };
  }, [comments]);

  // The member filter keeps whole threads: one shows wherever the member
  // wrote the root or any reply, with the rest of the thread as context.
  const visibleThreads = useMemo(() => {
    let rows = threads;
    if (authorFilter !== "all") {
      rows = threads.filter(
        ({ root, replies }) =>
          root.author.id === authorFilter ||
          replies.some((reply) => reply.author.id === authorFilter)
      );
    }
    return sortOrder === "newest" ? [...rows].reverse() : rows;
  }, [threads, authorFilter, sortOrder]);

  const visibleCount = visibleThreads.reduce((sum, { replies }) => sum + 1 + replies.length, 0);

  function authorName(comment: CommentView): string {
    return comment.author.name ?? comment.author.email;
  }

  /** The display-only "@name" a reply answers: its direct parent's author. */
  function repliedToName(reply: CommentView): string | null {
    const parent = reply.parentId ? byId.get(reply.parentId) : undefined;
    return parent ? authorName(parent) : null;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    await fetch(`/api/papers/${paperId}/comments`, {
      method: "POST",
      body: formData
    });

    form.reset();
    router.refresh();
  }

  async function submitReply(parentId: string, body: string) {
    const response = await fetch(`/api/papers/${paperId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, parentId })
    });
    if (!response.ok) throw new Error("reply failed");
    setReplyTo(null);
    router.refresh();
  }

  async function mutate(commentId: string, init: RequestInit) {
    const response = await fetch(`/api/papers/${paperId}/comments/${commentId}`, init);
    if (!response.ok) throw new Error("comment mutation failed");
    // The list arrives as a server prop, so only a re-render reflects the change.
    router.refresh();
  }

  return (
    <section className="flex h-full min-w-0 flex-col rounded border border-border bg-white shadow-card">
      {/* No panel heading — the active tab already names this view. Same
          shape as the annotations header: filters left, count right. */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <select
          aria-label={t("authorFilterAria")}
          className="rounded border border-control px-1.5 py-1 text-xs"
          value={authorFilter}
          onChange={(event) => setAuthorFilter(event.target.value)}
        >
          <option value="all">{t("filterAllMembers")}</option>
          {authors.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          aria-label={t("sortAria")}
          className="rounded border border-control px-1.5 py-1 text-xs"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value as "oldest" | "newest")}
        >
          <option value="oldest">{t("sortOldest")}</option>
          <option value="newest">{t("sortNewest")}</option>
        </select>
        <span className="ml-auto whitespace-nowrap text-xs text-muted">
          {t("count", { count: visibleCount })}
        </span>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border overflow-auto">
        {visibleThreads.map(({ root, replies }) => (
          <div className="px-4 py-3" key={root.id}>
            <article>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span>{authorName(root)}</span>
                {root.pageNumber ? (
                  <span className="rounded bg-surface px-1.5 py-0.5">
                    {t("pageBadge", { page: root.pageNumber })}
                  </span>
                ) : null}
                <TimeStamp value={root.createdAt} className="ml-auto text-[11px] text-muted" />
              </div>
              {root.quotedText ? (
                <blockquote className="mt-1.5 border-l-2 border-accent/30 pl-3 text-xs italic text-muted">
                  &ldquo;{root.quotedText}&rdquo;
                </blockquote>
              ) : null}
              <div className="mt-1.5">
                <CommentBody
                  body={root.body}
                  canModify={canModifyComment(currentUserRole, root.author.id === currentUserId)}
                  replyCount={descendants.get(root.id) ?? 0}
                  onReply={() => setReplyTo(replyTo === root.id ? null : root.id)}
                  onEdit={(body) =>
                    mutate(root.id, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ body })
                    })
                  }
                  onDelete={() => mutate(root.id, { method: "DELETE" })}
                />
              </div>
              {replyTo === root.id ? (
                <ReplyComposer
                  placeholder={t("replyPlaceholder", { name: authorName(root) })}
                  onSubmit={(body) => submitReply(root.id, body)}
                  onCancel={() => setReplyTo(null)}
                />
              ) : null}
            </article>
            {replies.map((reply) => (
              <article
                className="ml-5 mt-2 border-l-2 border-border pl-3"
                key={reply.id}
              >
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>{authorName(reply)}</span>
                  <TimeStamp value={reply.createdAt} className="ml-auto text-[11px] text-muted" />
                </div>
                <div className="mt-1">
                  {repliedToName(reply) ? (
                    <p className="text-xs font-medium text-accent">@{repliedToName(reply)}</p>
                  ) : null}
                  <CommentBody
                    body={reply.body}
                    canModify={canModifyComment(currentUserRole, reply.author.id === currentUserId)}
                    replyCount={descendants.get(reply.id) ?? 0}
                    onReply={() => setReplyTo(replyTo === reply.id ? null : reply.id)}
                    onEdit={(body) =>
                      mutate(reply.id, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ body })
                      })
                    }
                    onDelete={() => mutate(reply.id, { method: "DELETE" })}
                  />
                </div>
                {replyTo === reply.id ? (
                  <ReplyComposer
                    placeholder={t("replyPlaceholder", { name: authorName(reply) })}
                    onSubmit={(body) => submitReply(reply.id, body)}
                    onCancel={() => setReplyTo(null)}
                  />
                ) : null}
              </article>
            ))}
          </div>
        ))}
        {visibleThreads.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">{t("empty")}</p>
        ) : null}
      </div>
      <form
        ref={formRef}
        className="grid shrink-0 gap-2 border-t border-border p-4"
        onSubmit={handleSubmit}
      >
        <textarea
          className="min-h-20 rounded border border-control px-3 py-2 text-sm"
          name="body"
          placeholder={t("placeholder")} aria-label={t("placeholder")}
          required
        />
        <button className="rounded bg-accent transition-transform duration-150 active:scale-[0.98] px-3 py-2 text-sm font-medium text-white" type="submit">{t("submit")}</button>
      </form>
    </section>
  );
}

/**
 * Inline reply form, mounted under the comment being answered. Submission is
 * button-only (Enter inserts a newline), which sidesteps IME double-submit
 * entirely; the caller closes the composer on success.
 */
function ReplyComposer({
  placeholder,
  onSubmit,
  onCancel
}: {
  placeholder: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const t = useTranslations("comments");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSubmit(text);
    } catch {
      // Keep the draft so the reply is not lost.
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 grid gap-1.5">
      <textarea
        autoFocus
        className="min-h-16 w-full rounded border border-control px-2 py-1.5 text-sm"
        placeholder={placeholder}
        aria-label={placeholder}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        disabled={busy}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded bg-accent transition-transform duration-150 active:scale-[0.98] px-2 py-0.5 text-xs text-white disabled:opacity-50"
          onClick={() => void submit()}
          disabled={busy || !body.trim()}
        >
          {t("reply")}
        </button>
        <button type="button" className="text-xs text-muted hover:underline" onClick={onCancel} disabled={busy}>
          {t("cancel")}
        </button>
        {failed ? <span role="alert" className="text-xs text-danger">{t("actionFailed")}</span> : null}
      </div>
    </div>
  );
}
