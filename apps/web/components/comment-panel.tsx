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

  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const comment of comments) {
      map.set(comment.author.id, comment.author.name ?? comment.author.email);
    }
    return [...map.entries()];
  }, [comments]);

  // Replies stay with their filtered parent: hiding a reply whose parent
  // matches would make threads read as truncated. The server delivers
  // createdAt asc, which is the "oldest" order.
  const visible = useMemo(() => {
    let rows = comments;
    if (authorFilter !== "all") {
      const kept = new Set(
        comments.filter((comment) => comment.author.id === authorFilter).map((it) => it.id)
      );
      rows = comments.filter(
        (comment) =>
          kept.has(comment.id) || (comment.parentId !== null && kept.has(comment.parentId))
      );
    }
    return sortOrder === "newest" ? [...rows].reverse() : rows;
  }, [comments, authorFilter, sortOrder]);

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

  async function mutate(commentId: string, init: RequestInit) {
    const response = await fetch(`/api/papers/${paperId}/comments/${commentId}`, init);
    if (!response.ok) throw new Error("comment mutation failed");
    // The list arrives as a server prop, so only a re-render reflects the change.
    router.refresh();
  }

  return (
    <section className="flex h-full min-w-0 flex-col rounded border border-border bg-white">
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
          {t("count", { count: visible.length })}
        </span>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border overflow-auto">
        {visible.map((comment) => (
          <article className="px-4 py-3" key={comment.id}>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{comment.author.name ?? comment.author.email}</span>
              {comment.pageNumber ? (
                <span className="rounded bg-surface px-1.5 py-0.5">
                  {t("pageBadge", { page: comment.pageNumber })}
                </span>
              ) : null}
              <TimeStamp value={comment.createdAt} className="ml-auto text-[11px] text-muted" />
            </div>
            {comment.quotedText ? (
              <blockquote className="mt-1.5 border-l-2 border-accent/30 pl-3 text-xs italic text-muted">
                &ldquo;{comment.quotedText}&rdquo;
              </blockquote>
            ) : null}
            <div className="mt-1.5">
              <CommentBody
                body={comment.body}
                canModify={canModifyComment(currentUserRole, comment.author.id === currentUserId)}
                replyCount={comments.filter((it) => it.parentId === comment.id).length}
                onEdit={(body) =>
                  mutate(comment.id, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ body })
                  })
                }
                onDelete={() => mutate(comment.id, { method: "DELETE" })}
              />
            </div>
          </article>
        ))}
        {visible.length === 0 ? <p className="px-4 py-6 text-sm text-muted">{t("empty")}</p> : null}
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
        <button className="rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">{t("submit")}</button>
      </form>
    </section>
  );
}
