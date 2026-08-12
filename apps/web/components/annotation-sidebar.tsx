"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { annotationColor } from "@paper-viewer/core/labels";
import type { AnnotationView, LabelView } from "@/lib/annotation-types";
import { CommentBody } from "./comment-body";
import { ConfirmDialog } from "./confirm-dialog";
import { LabelChip } from "./label-chip";

export function AnnotationSidebar({
  annotations,
  labels,
  currentUserId,
  selectedId,
  onJump,
  onReply,
  onEditComment,
  onDeleteComment,
  onDelete
}: {
  annotations: AnnotationView[];
  labels: LabelView[];
  currentUserId: string;
  selectedId: string | null;
  onJump: (annotation: AnnotationView) => void;
  onReply: (annotationId: string, body: string) => Promise<void>;
  onEditComment: (commentId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onDelete: (annotation: AnnotationView) => Promise<void>;
}) {
  const t = useTranslations("annotations");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [pendingDelete, setPendingDelete] = useState<AnnotationView | null>(null);
  const [deleting, setDeleting] = useState(false);

  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const annotation of annotations) {
      map.set(annotation.author.id, annotation.author.name ?? annotation.author.email);
    }
    return [...map.entries()];
  }, [annotations]);

  // The API delivers annotations ordered by page asc, createdAt asc; keep that
  // order, and carry each row's colour alongside so the dot and the quote rule
  // resolve it once.
  const filtered = useMemo(
    () =>
      annotations
        .filter(
          (annotation) =>
            (labelFilter === "all" ||
              annotation.labels.some((label) => label.id === labelFilter)) &&
            (authorFilter === "all" || annotation.author.id === authorFilter)
        )
        .map((annotation) => ({ annotation, color: annotationColor(annotation.labels) })),
    [annotations, authorFilter, labelFilter]
  );

  return (
    <section className="flex h-full min-w-0 flex-col rounded border border-border bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <select
          aria-label={t("labelFilterAria")}
          className="rounded border border-control px-1.5 py-1 text-xs"
          value={labelFilter}
          onChange={(event) => setLabelFilter(event.target.value)}
        >
          <option value="all">{t("filterAllLabels")}</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
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
        <span className="ml-auto text-xs text-muted">{t("count", { count: filtered.length })}</span>
      </div>
      <div className="min-h-0 flex-1 divide-y divide-border overflow-auto">
        {filtered.map(({ annotation, color }) => (
          <article
            key={annotation.id}
            className={`px-3 py-2.5 ${selectedId === annotation.id ? "bg-surface" : ""}`}
          >
            <button type="button" className="block w-full text-left" onClick={() => onJump(annotation)}>
              <div className="flex items-center gap-2 text-xs text-muted">
                {/* The dot always mirrors the colour this annotation is painted
                    with in the document — label names travel as text chips below. */}
                <span
                  aria-hidden
                  title={t("dotTitle")}
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: color }}
                />
                <span>{annotation.author.name ?? annotation.author.email}</span>
                <span className="rounded bg-surface px-1.5 py-0.5">
                  {t("pageBadge", { page: annotation.pageNumber })}
                </span>
                <span>{annotation.type === "area" ? t("typeArea") : t("typeHighlight")}</span>
              </div>
              {annotation.areaImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- small API-served thumbnail
                <img
                  src={annotation.areaImageUrl}
                  alt={t("areaImageAlt")}
                  loading="lazy"
                  className="mt-1 max-h-24 w-auto rounded border border-border"
                />
              ) : null}
              {annotation.quotedText ? (
                <blockquote
                  className="mt-1 border-l-2 pl-2 text-xs italic text-muted line-clamp-2"
                  style={{ borderColor: color }}
                >
                  &ldquo;{annotation.quotedText}&rdquo;
                </blockquote>
              ) : null}
              {annotation.labels.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {annotation.labels.map((label) => (
                    <LabelChip key={label.id} name={label.name} color={label.color} />
                  ))}
                </div>
              ) : null}
            </button>

            <div className="mt-1.5 space-y-1.5">
              {annotation.comments.map((comment) => (
                <div key={comment.id} className={comment.parentId ? "ml-4" : ""}>
                  <span className="text-xs font-medium">
                    {comment.author.name ?? comment.author.email}
                  </span>
                  <CommentBody
                    body={comment.body}
                    isAuthor={comment.author.id === currentUserId}
                    replyCount={
                      annotation.comments.filter((it) => it.parentId === comment.id).length
                    }
                    textClassName="text-xs"
                    onEdit={(body) => onEditComment(comment.id, body)}
                    onDelete={() => onDeleteComment(comment.id)}
                  />
                </div>
              ))}
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded border border-control px-2 py-1 text-xs"
                placeholder={t("replyPlaceholder")} aria-label={t("replyPlaceholder")}
                value={replyDrafts[annotation.id] ?? ""}
                onChange={(event) =>
                  setReplyDrafts((drafts) => ({ ...drafts, [annotation.id]: event.target.value }))
                }
                onKeyDown={async (event) => {
                  if (event.key !== "Enter") return;
                  const body = (replyDrafts[annotation.id] ?? "").trim();
                  if (!body) return;
                  event.preventDefault();
                  try {
                    await onReply(annotation.id, body);
                  } catch {
                    // Keep the draft so the reply is not lost; the workspace
                    // surfaces the failure in its error banner.
                    return;
                  }
                  setReplyDrafts((drafts) => ({ ...drafts, [annotation.id]: "" }));
                }}
              />
              {annotation.author.id === currentUserId ? (
                <button
                  type="button"
                  className="text-xs text-danger"
                  onClick={() => setPendingDelete(annotation)}
                >
                  {t("delete")}
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-sm text-muted">{t("empty")}</p>
        ) : null}
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        message={
          pendingDelete ? t("deleteConfirm", { count: pendingDelete.comments.length }) : ""
        }
        confirmLabel={t("delete")}
        busy={deleting}
        onConfirm={async () => {
          if (!pendingDelete || deleting) return;
          setDeleting(true);
          try {
            await onDelete(pendingDelete);
          } finally {
            // Failures surface in the workspace error banner; either way the
            // dialog has done its job.
            setDeleting(false);
            setPendingDelete(null);
          }
        }}
        onCancel={() => {
          if (!deleting) setPendingDelete(null);
        }}
      />
    </section>
  );
}
