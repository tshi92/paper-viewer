"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Avatar } from "./avatar";
import { ConfirmDialog } from "./confirm-dialog";
import { MarkdownBody } from "./markdown-body";
import { RowMenu } from "./row-menu";
import { TimeStamp } from "./time-stamp";
import { toast } from "./toast";

export type CommentAuthor = { name: string | null; email: string };

/**
 * One comment — header, text, and its actions — shared by the paper-level
 * Discussion panel and the annotation threads so both read the same.
 *
 * The header lives here rather than in each panel because the overflow menu
 * belongs beside the author's name, and the menu can only be driven by the
 * edit/delete state this component owns. The caller decides who may modify
 * (author, or admins/owners moderating) — everyone else gets the text alone,
 * and the API enforces the same rule server-side.
 */
export function CommentRow({
  author,
  createdAt,
  body,
  canModify,
  replyCount,
  headerExtra,
  bodyPrefix,
  textClassName = "text-sm",
  onReply,
  onEdit,
  onDelete
}: {
  author: CommentAuthor;
  /** A Date from a server component, an ISO string from a client fetch. */
  createdAt: string | Date;
  body: string;
  canModify: boolean;
  /** Replies below this comment, used to warn that deleting takes the thread with it. */
  replyCount: number;
  /** Extra header content, e.g. the page a discussion comment was anchored to. */
  headerExtra?: ReactNode;
  /** Rendered above the text, e.g. the "@name" a reply is addressed to. */
  bodyPrefix?: ReactNode;
  textClassName?: string;
  /** Renders a reply action when set; annotation threads have their own composer and omit it. */
  onReply?: () => void;
  onEdit: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslations("comments");
  const tCommon = useTranslations("common");
  // `null` means "not editing"; any string is the in-progress draft.
  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function handleSave() {
    const next = (draft ?? "").trim();
    if (!next || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onEdit(next);
      setDraft(null);
    } catch {
      // Keep the draft open so the edit is not lost.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onDelete();
      setConfirmingDelete(false);
    } catch {
      setFailed(true);
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  /**
   * Copies the raw markdown, not the rendered text, so a pasted chat reply
   * keeps its headings, lists and code fences. The menu closes on select, so
   * the confirmation is a toast rather than a label swap on the item.
   */
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(body);
      toast.success(tCommon("copied"));
    } catch {
      // A denied clipboard permission is not worth an error banner.
    }
  }

  // Avatar (1.5rem) + gap-1.5 (0.375rem): the text column starts under the name.
  const bodyIndent = "pl-[1.875rem]";

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Avatar name={author.name} email={author.email} />
        <span className="truncate text-xs font-medium">{author.name ?? author.email}</span>
        <TimeStamp value={createdAt} className="shrink-0 text-[11px] text-muted" />
        {headerExtra}
        <span className="ml-auto">
          {/* Copy, edit and delete fold into one menu beside the name — three
              permanent text buttons under a one-line reply were more chrome
              than content. Reply stays in the open below; it is the action a
              thread exists for. */}
          <RowMenu
            items={[
              { label: tCommon("copy"), onSelect: () => void handleCopy() },
              ...(canModify && !busy
                ? [
                    { label: t("edit"), onSelect: () => setDraft(body) },
                    { label: t("delete"), onSelect: () => setConfirmingDelete(true), danger: true }
                  ]
                : [])
            ]}
          />
        </span>
      </div>

      <div className={`mt-0.5 ${bodyIndent}`}>
        {draft !== null ? (
          <div className="grid gap-1.5">
            <textarea
              // field-sizing grows the box with its content (Chrome 123+); the
              // min/max clamp is the fallback everywhere else.
              className={`min-h-40 w-full rounded-md border border-control px-2 py-1.5 [field-sizing:content] max-h-[45vh] ${textClassName}`}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="rounded-md bg-accent transition-transform duration-150 active:scale-[0.98] px-2 py-0.5 text-xs text-white disabled:opacity-50"
                onClick={() => void handleSave()}
                disabled={busy || !draft.trim()}
              >
                {t("save")}
              </button>
              <button
                type="button"
                className="text-xs text-muted hover:underline"
                onClick={() => {
                  setDraft(null);
                  setFailed(false);
                }}
                disabled={busy}
              >
                {t("cancel")}
              </button>
              {failed ? <span role="alert" className="text-xs text-danger">{t("actionFailed")}</span> : null}
            </div>
          </div>
        ) : (
          <>
            {bodyPrefix}
            {/* Comments carry markdown — chat replies saved here arrive full of
                headings and lists — and editing hands back the raw source. */}
            <MarkdownBody className={textClassName}>{body}</MarkdownBody>
            {onReply || failed ? (
              <div className="mt-1 flex items-center gap-2">
                {onReply ? (
                  <button type="button" className="text-xs text-accent hover:underline" onClick={onReply}>
                    {t("reply")}
                  </button>
                ) : null}
                {failed ? <span role="alert" className="text-xs text-danger">{t("actionFailed")}</span> : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        message={t("deleteConfirm", { count: replyCount })}
        confirmLabel={t("delete")}
        busy={busy}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!busy) setConfirmingDelete(false);
        }}
      />
    </div>
  );
}
