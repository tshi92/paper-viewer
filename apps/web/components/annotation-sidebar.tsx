"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { annotationColor } from "@paper-viewer/core/labels";
import { canDeleteAnnotation, canModifyComment, type WorkspaceRole } from "@paper-viewer/core/permissions";
import type { AnnotationView, LabelView } from "@/lib/annotation-types";
import { Avatar } from "./avatar";
import { CommentRow } from "./comment-row";
import { ConfirmDialog } from "./confirm-dialog";
import { LabelChip } from "./label-chip";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { TimeStamp } from "./time-stamp";
import { toast } from "./toast";

type SortOrder = "position" | "newest" | "oldest";

/**
 * Comments shown before a thread collapses. Two keeps the opening exchange —
 * the note and its first answer — which is what a reader scanning the panel
 * needs; a third comment means the discussion is worth opening deliberately.
 */
const COLLAPSED_COMMENTS = 2;

export function AnnotationSidebar({
  annotations,
  labels,
  currentUserId,
  currentUserRole,
  selectedId,
  onJump,
  onSelect,
  onReply,
  onEditComment,
  onDeleteComment,
  onUpdateLabels,
  onDelete
}: {
  annotations: AnnotationView[];
  labels: LabelView[];
  currentUserId: string;
  currentUserRole: WorkspaceRole;
  selectedId: string | null;
  onJump: (annotation: AnnotationView) => void;
  /** Marks the annotation as current without scrolling the document to it. */
  onSelect: (annotationId: string) => void;
  onReply: (annotationId: string, body: string) => Promise<void>;
  onEditComment: (commentId: string, body: string) => Promise<void>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onUpdateLabels: (annotationId: string, labelIds: string[]) => Promise<void>;
  onDelete: (annotation: AnnotationView) => Promise<void>;
}) {
  const t = useTranslations("annotations");
  const tCommon = useTranslations("common");
  const [labelFilter, setLabelFilter] = useState<string>("all");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("position");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  // Reply posts already in flight; a second Enter before the first resolves
  // must not send the same draft again.
  const sendingReplies = useRef(new Set<string>());
  const [pendingDelete, setPendingDelete] = useState<AnnotationView | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Threads the reader opened past their first two comments.
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
  // Which annotation's labels are being edited, and the in-progress selection.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabelIds, setDraftLabelIds] = useState<string[]>([]);
  const [draftComment, setDraftComment] = useState("");
  const [savingEdits, setSavingEdits] = useState(false);

  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const annotation of annotations) {
      map.set(annotation.author.id, annotation.author.name ?? annotation.author.email);
    }
    return [...map.entries()];
  }, [annotations]);

  // The API delivers annotations ordered by page asc, createdAt asc — that is
  // the "position" order. Time sorts rearrange a copy; the colour rides along
  // so the dot and the quote rule resolve it once.
  const filtered = useMemo(() => {
    const rows = annotations
      .filter(
        (annotation) =>
          (labelFilter === "all" ||
            annotation.labels.some((label) => label.id === labelFilter)) &&
          (authorFilter === "all" || annotation.author.id === authorFilter)
      )
      .map((annotation) => ({ annotation, color: annotationColor(annotation.labels) }));
    if (sortOrder !== "position") {
      rows.sort((a, b) => {
        const delta =
          new Date(a.annotation.createdAt).getTime() - new Date(b.annotation.createdAt).getTime();
        return sortOrder === "newest" ? -delta : delta;
      });
    }
    return rows;
  }, [annotations, authorFilter, labelFilter, sortOrder]);

  // Page headings only make sense while the list is in document order; a time
  // sort interleaves pages, which would produce a heading per card.
  const groupByPage = sortOrder === "position";

  async function copyQuote(quotedText: string) {
    try {
      await navigator.clipboard.writeText(quotedText);
      toast.success(tCommon("copied"));
    } catch {
      // A denied clipboard permission is not worth an error banner.
    }
  }

  function startEditing(annotation: AnnotationView) {
    setEditingId(annotation.id);
    setDraftLabelIds(annotation.labels.map((label) => label.id));
    setDraftComment("");
  }

  /**
   * Editing an annotation means its labels, plus a note when the thread is
   * still empty.
   *
   * There is no stored "first comment" to edit: the comment the create tip
   * offers is posted as an ordinary comment, so `comments[0]` is simply the
   * oldest one in the thread — which may well be someone's reply. That comment
   * is already listed below with its own edit action, so offering it here too
   * would edit one row from two places. The composer therefore only appears
   * while there is nothing to duplicate.
   */
  async function saveEdits(annotation: AnnotationView) {
    if (savingEdits) return;
    setSavingEdits(true);
    try {
      const currentLabelIds = annotation.labels.map((label) => label.id);
      const labelsChanged =
        currentLabelIds.length !== draftLabelIds.length ||
        currentLabelIds.some((id) => !draftLabelIds.includes(id));
      if (labelsChanged) {
        await onUpdateLabels(annotation.id, draftLabelIds);
      }

      const body = draftComment.trim();
      if (body && annotation.comments.length === 0) {
        await onReply(annotation.id, body);
      }
      setEditingId(null);
    } catch {
      // Keep the editor open so the edit is not lost; the workspace surfaces
      // the failure in its error banner.
    } finally {
      setSavingEdits(false);
    }
  }

  /**
   * An area annotation's screenshot goes to the clipboard as an image, so it
   * can be pasted straight into a doc or a chat. Unlike the text copies this
   * one reports failure: the write can be refused for reasons the reader can
   * act on (an unfocused document, a browser without image clipboard support),
   * and a silent no-op would read as the menu item being broken.
   */
  async function copyAreaImage(url: string) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`image fetch failed: ${response.status}`);
      const blob = await response.blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast.success(tCommon("copied"));
    } catch {
      toast.error(tCommon("copyFailed"));
    }
  }

  return (
    <section className="flex h-full min-w-0 flex-col rounded border border-border bg-white shadow-card">
      {/* Three selects plus the count outgrow 360px in English — let it wrap. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
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
        <select
          aria-label={t("sortAria")}
          className="rounded border border-control px-1.5 py-1 text-xs"
          value={sortOrder}
          onChange={(event) => setSortOrder(event.target.value as SortOrder)}
        >
          <option value="position">{t("sortPosition")}</option>
          <option value="newest">{t("sortNewest")}</option>
          <option value="oldest">{t("sortOldest")}</option>
        </select>
        <span className="ml-auto whitespace-nowrap text-xs text-muted">
          {t("count", { count: filtered.length })}
        </span>
      </div>
      {/* Separators live on each card (border-t only) instead of divide-*:
          .divide-border's child selector outranks the cards' own
          border-l-accent/transparent and painted every non-first left edge
          gray, so selection was only ever visible on the first card. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {filtered.map(({ annotation, color }, index) => {
          const startsPageGroup =
            groupByPage && annotation.pageNumber !== filtered[index - 1]?.annotation.pageNumber;
          const expanded = expandedThreads.has(annotation.id);
          const visibleComments = expanded
            ? annotation.comments
            : annotation.comments.slice(0, COLLAPSED_COMMENTS);
          const hiddenComments = annotation.comments.length - visibleComments.length;
          const menuItems: RowMenuItem[] = [
            ...(annotation.quotedText
              ? [{ label: tCommon("copy"), onSelect: () => void copyQuote(annotation.quotedText!) }]
              : []),
            // An area annotation has a screenshot instead of a quote, so its
            // copy is the image.
            ...(annotation.areaImageUrl
              ? [
                  {
                    label: t("copyImage"),
                    onSelect: () => void copyAreaImage(annotation.areaImageUrl!)
                  }
                ]
              : []),
            // Editing means the labels: the quote is fixed by the passage it
            // marks, and each comment carries its own edit. Author-only, which
            // is what the PATCH route enforces — an annotation's labels are the
            // author's reading of the passage, not something to moderate.
            ...(annotation.author.id === currentUserId
              ? [{ label: t("edit"), onSelect: () => startEditing(annotation) }]
              : []),
            // Plain "Delete": the menu belongs to one annotation card, so the
            // object being deleted is never in question. Open to admins on
            // anyone's annotation, matching comments.
            ...(canDeleteAnnotation(currentUserRole, annotation.author.id === currentUserId)
              ? [{ label: t("delete"), onSelect: () => setPendingDelete(annotation), danger: true }]
              : [])
          ];
          return (
          <div key={annotation.id}>
            {/* In document order the list reads as a walk through the paper, so
                the page is a heading over a run of cards rather than a badge
                repeated on each one. Time sorts interleave pages, so there the
                page goes back on the card (below). */}
            {startsPageGroup ? (
              // A tinted band, in the same inset tone used inside every other
              // card in the app — a recessed page ground here would read as a
              // second surface floating inside the panel.
              <h3 className="sticky top-0 z-10 border-y border-border bg-surface px-3 py-1.5 text-xs font-semibold text-muted">
                {t("pageBadge", { page: annotation.pageNumber })}
              </h3>
            ) : null}
            <article
              // A click anywhere on the card makes it the current annotation
              // (blue edge) — users read the whole card as one object, not just
              // the quote/image jump button. The annotator's selection effect
              // then brings the annotation into view once per selection.
              onClick={() => onSelect(annotation.id)}
              // Full-bleed rows separated by hairlines, not floating cards: a
              // card would need a ring to show selection, and a ring is clipped
              // by the sticky page band above it.
              className={`border-l-2 px-3 py-2.5 transition-colors duration-150 ${
                index > 0 && !startsPageGroup ? "border-t border-t-border" : ""
              } ${
                selectedId === annotation.id
                  ? "border-l-accent bg-accent/5"
                  : "border-l-transparent hover:bg-surface"
              }`}
            >
              {/* The meta row lives outside the jump button so the annotation's own
                  delete action can sit next to the timestamp — inside the reply row
                  it read as "delete this reply". */}
              <div className="flex items-start gap-2">
                <Avatar name={annotation.author.name} email={annotation.author.email} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium">
                      {annotation.author.name ?? annotation.author.email}
                    </span>
                    {/* The dot always mirrors the colour this annotation is painted
                        with in the document — label names travel as text chips below. */}
                    <span
                      aria-hidden
                      title={t("dotTitle")}
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: color }}
                    />
                    <span className="text-[11px] text-muted">
                      {annotation.type === "area" ? t("typeArea") : t("typeHighlight")}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted">
                    <TimeStamp value={annotation.createdAt} />
                    {!groupByPage ? (
                      <span className="rounded-sm bg-surface px-1.5">
                        {t("pageBadge", { page: annotation.pageNumber })}
                      </span>
                    ) : null}
                  </div>
                </div>
                {/* Copying the quote is useful to everyone; deleting the
                    annotation is the author's own action. An area annotation by
                    someone else leaves nothing to offer, and gets no menu. */}
                {menuItems.length > 0 ? <RowMenu items={menuItems} /> : null}
              </div>
              {/* Labels sit above the quote — they say what kind of note this
                  is, which is what to read before the passage itself — and
                  outside the jump button, since editing puts buttons here. */}
              {editingId === annotation.id ? (
                <div className="mt-2" onClick={(event) => event.stopPropagation()}>
                  <div className="flex flex-wrap gap-1">
                    {labels.map((label) => {
                      const picked = draftLabelIds.includes(label.id);
                      return (
                        <button
                          key={label.id}
                          type="button"
                          aria-pressed={picked}
                          disabled={savingEdits}
                          onClick={() =>
                            setDraftLabelIds((current) =>
                              picked
                                ? current.filter((it) => it !== label.id)
                                : [...current, label.id]
                            )
                          }
                        >
                          <LabelChip name={label.name} color={label.color} dimmed={!picked} />
                        </button>
                      );
                    })}
                  </div>
                  {/* Only while the thread is empty — see saveEdits. Once a
                      comment exists it is edited from its own row below. */}
                  {annotation.comments.length === 0 ? (
                    <textarea
                      className="mt-1.5 min-h-16 w-full rounded-md border border-control px-2 py-1.5 text-xs [field-sizing:content] max-h-[30vh]"
                      placeholder={t("tipCommentPlaceholder")}
                      aria-label={t("tipCommentPlaceholder")}
                      value={draftComment}
                      disabled={savingEdits}
                      onChange={(event) => setDraftComment(event.target.value)}
                    />
                  ) : null}
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-accent px-2 py-0.5 text-xs text-white transition-transform duration-150 active:scale-[0.98] disabled:opacity-50"
                      disabled={savingEdits}
                      onClick={() => void saveEdits(annotation)}
                    >
                      {t("save")}
                    </button>
                    <button
                      type="button"
                      className="text-xs text-muted hover:underline"
                      disabled={savingEdits}
                      onClick={() => setEditingId(null)}
                    >
                      {t("cancel")}
                    </button>
                  </div>
                </div>
              ) : annotation.labels.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {annotation.labels.map((label) => (
                    <LabelChip key={label.id} name={label.name} color={label.color} />
                  ))}
                </div>
              ) : null}
              <button type="button" className="block w-full text-left" onClick={() => onJump(annotation)}>
                {annotation.areaImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small API-served thumbnail
                  <img
                    src={annotation.areaImageUrl}
                    alt={t("areaImageAlt")}
                    loading="lazy"
                    className="mt-2 max-h-24 w-auto rounded-md border border-border"
                  />
                ) : null}
                {annotation.quotedText ? (
                  // A quote rule in the annotation's own colour, not a filled
                  // block: the fill competed with the text for attention and
                  // read as a second highlight rather than as quoted material.
                  <blockquote
                    className="mt-2 border-l-2 pl-2 text-xs italic leading-relaxed text-muted line-clamp-3"
                    style={{ borderColor: color }}
                  >
                    &ldquo;{annotation.quotedText}&rdquo;
                  </blockquote>
                ) : null}
              </button>

              <div className="mt-2 space-y-2">
                {visibleComments.map((comment) => (
                  <div
                    key={comment.id}
                    // A reply is offset by a rule rather than bare indentation,
                    // so a thread's shape survives at 320px.
                    className={comment.parentId ? "border-l border-border pl-2.5 ml-2" : ""}
                  >
                    <CommentRow
                      author={comment.author}
                      createdAt={comment.createdAt}
                      body={comment.body}
                      canModify={canModifyComment(
                        currentUserRole,
                        comment.author.id === currentUserId
                      )}
                      replyCount={
                        annotation.comments.filter((it) => it.parentId === comment.id).length
                      }
                      textClassName="text-xs"
                      onEdit={(body) => onEditComment(comment.id, body)}
                      onDelete={() => onDeleteComment(comment.id)}
                    />
                  </div>
                ))}
                {/* A long thread collapses to its first exchange; the rest is
                    one click away. Without this a single busy annotation can
                    push every other one off the panel. */}
                {hiddenComments > 0 || expanded ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-accent hover:underline"
                    onClick={() =>
                      setExpandedThreads((current) => {
                        const next = new Set(current);
                        if (next.has(annotation.id)) next.delete(annotation.id);
                        else next.add(annotation.id);
                        return next;
                      })
                    }
                  >
                    {expanded ? t("fewerComments") : t("moreComments", { count: hiddenComments })}
                  </button>
                ) : null}
              </div>

              <div className="mt-2 flex items-center gap-2">
                <input
                  className="min-w-0 flex-1 rounded-md border border-control bg-white px-2.5 py-1.5 text-xs"
                  placeholder={t("replyPlaceholder")} aria-label={t("replyPlaceholder")}
                  value={replyDrafts[annotation.id] ?? ""}
                  onChange={(event) =>
                    setReplyDrafts((drafts) => ({ ...drafts, [annotation.id]: event.target.value }))
                  }
                  onKeyDown={async (event) => {
                  if (event.key !== "Enter") return;
                  // An IME's confirm-candidate Enter arrives as a keydown too;
                  // without this guard one physical Enter posts the reply twice.
                  if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                  const body = (replyDrafts[annotation.id] ?? "").trim();
                  if (!body) return;
                  event.preventDefault();
                  if (sendingReplies.current.has(annotation.id)) return;
                  sendingReplies.current.add(annotation.id);
                  try {
                    await onReply(annotation.id, body);
                  } catch {
                    // Keep the draft so the reply is not lost; the workspace
                    // surfaces the failure in its error banner.
                    return;
                  } finally {
                    sendingReplies.current.delete(annotation.id);
                  }
                  setReplyDrafts((drafts) => ({ ...drafts, [annotation.id]: "" }));
                }}
                />
              </div>
            </article>
          </div>
          );
        })}
        {filtered.length === 0 ? (
          <p className="bg-white px-3 py-6 text-sm text-muted">{t("empty")}</p>
        ) : null}
      </div>
      <ConfirmDialog
        open={pendingDelete !== null}
        message={
          pendingDelete
            ? // Lead with what is being deleted: the quote is the annotation's
              // identity, so the decision does not rely on memory.
              `${
                pendingDelete.quotedText
                  ? `“${pendingDelete.quotedText.slice(0, 80)}${pendingDelete.quotedText.length > 80 ? "…" : ""}”\n`
                  : ""
              }${t("deleteConfirm", { count: pendingDelete.comments.length })}`
            : ""
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
