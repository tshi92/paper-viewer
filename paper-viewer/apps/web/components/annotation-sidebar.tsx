"use client";

import { useMemo, useState } from "react";
import { annotationColor } from "@paper-viewer/core/labels";
import type { AnnotationView, LabelView } from "@/lib/annotation-types";

export function AnnotationSidebar({
  annotations,
  labels,
  currentUserId,
  isAdmin,
  selectedId,
  onJump,
  onReply,
  onDelete
}: {
  annotations: AnnotationView[];
  labels: LabelView[];
  currentUserId: string;
  isAdmin: boolean;
  selectedId: string | null;
  onJump: (annotation: AnnotationView) => void;
  onReply: (annotationId: string, body: string, parentId?: string) => Promise<void>;
  onDelete: (annotation: AnnotationView) => Promise<void>;
}) {
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const annotation of annotations) {
      map.set(annotation.author.id, annotation.author.name ?? annotation.author.email);
    }
    return [...map.entries()];
  }, [annotations]);

  // The API delivers annotations ordered by page asc, createdAt asc; keep that order.
  const filtered = annotations.filter(
    (annotation) =>
      (labelFilter === "all" || annotation.labels.some((label) => label.id === labelFilter)) &&
      (authorFilter === "all" || annotation.author.id === authorFilter)
  );

  return (
    <section className="rounded border border-border bg-white">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <select
          className="rounded border border-border px-1.5 py-1 text-xs"
          value={labelFilter}
          onChange={(event) => setLabelFilter(event.target.value)}
        >
          <option value="all">全部 label</option>
          {labels.map((label) => (
            <option key={label.id} value={label.id}>
              {label.name}
            </option>
          ))}
        </select>
        <select
          className="rounded border border-border px-1.5 py-1 text-xs"
          value={authorFilter}
          onChange={(event) => setAuthorFilter(event.target.value)}
        >
          <option value="all">全部成员</option>
          {authors.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-muted">{filtered.length} 条</span>
      </div>
      <div className="max-h-[calc(100vh-320px)] divide-y divide-border overflow-auto">
        {filtered.map((annotation) => (
          <article
            key={annotation.id}
            className={`px-3 py-2.5 ${selectedId === annotation.id ? "bg-surface" : ""}`}
          >
            <button type="button" className="block w-full text-left" onClick={() => onJump(annotation)}>
              <div className="flex items-center gap-2 text-xs text-muted">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: annotationColor(annotation.labels) }}
                />
                <span>{annotation.author.name ?? annotation.author.email}</span>
                <span className="rounded bg-surface px-1.5 py-0.5">p.{annotation.pageNumber}</span>
                <span>{annotation.type === "area" ? "划区" : "高亮"}</span>
              </div>
              {annotation.quotedText ? (
                <blockquote
                  className="mt-1 border-l-2 pl-2 text-xs italic text-muted line-clamp-2"
                  style={{ borderColor: annotationColor(annotation.labels) }}
                >
                  &ldquo;{annotation.quotedText}&rdquo;
                </blockquote>
              ) : null}
              {annotation.labels.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {annotation.labels.map((label) => (
                    <span
                      key={label.id}
                      className="rounded px-1.5 py-0.5 text-[10px] text-white"
                      style={{ background: label.color }}
                    >
                      {label.name}
                    </span>
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
                  <p className="text-xs">{comment.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <input
                className="min-w-0 flex-1 rounded border border-border px-2 py-1 text-xs"
                placeholder="回复…"
                value={replyDrafts[annotation.id] ?? ""}
                onChange={(event) =>
                  setReplyDrafts((drafts) => ({ ...drafts, [annotation.id]: event.target.value }))
                }
                onKeyDown={async (event) => {
                  if (event.key !== "Enter") return;
                  const body = (replyDrafts[annotation.id] ?? "").trim();
                  if (!body) return;
                  event.preventDefault();
                  setReplyDrafts((drafts) => ({ ...drafts, [annotation.id]: "" }));
                  await onReply(annotation.id, body);
                }}
              />
              {annotation.author.id === currentUserId || isAdmin ? (
                <button
                  type="button"
                  className="text-xs text-red-500"
                  onClick={async () => {
                    if (
                      confirm(`删除该标注？其下 ${annotation.comments.length} 条评论将一并删除。`)
                    ) {
                      await onDelete(annotation);
                    }
                  }}
                >
                  删除
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {filtered.length === 0 ? (
          <p className="px-3 py-6 text-sm text-muted">暂无标注。选中文字或按住 ⌥ 拖拽即可创建。</p>
        ) : null}
      </div>
    </section>
  );
}
