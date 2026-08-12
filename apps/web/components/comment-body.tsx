"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ConfirmDialog } from "./confirm-dialog";
import { CopyTextButton } from "./copy-text-button";
import { MarkdownBody } from "./markdown-body";

/**
 * A comment's text plus the author-only edit/delete affordances, shared by the
 * paper-level Discussion panel and the annotation threads so both offer the same
 * interaction. Non-authors get the text alone — the API refuses their writes too.
 */
export function CommentBody({
  body,
  isAuthor,
  replyCount,
  textClassName = "text-sm",
  onEdit,
  onDelete
}: {
  body: string;
  isAuthor: boolean;
  /** Direct replies, used to warn that deleting takes the thread with it. */
  replyCount: number;
  textClassName?: string;
  onEdit: (body: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const t = useTranslations("comments");
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

  if (draft !== null) {
    return (
      <div className="grid gap-1.5">
        <textarea
          className={`min-h-16 w-full rounded border border-control px-2 py-1.5 ${textClassName}`}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={busy}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded bg-accent px-2 py-0.5 text-xs text-white disabled:opacity-50"
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
          {failed ? <span className="text-xs text-danger">{t("actionFailed")}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Comments carry markdown — chat replies saved here arrive full of headings
          and lists — and editing hands back the raw source. */}
      <MarkdownBody className={textClassName}>{body}</MarkdownBody>
      <div className="mt-1 flex items-center gap-2">
        <CopyTextButton text={body} />
        {isAuthor ? (
          <>
            <button
              type="button"
              className="text-xs text-muted hover:underline"
              onClick={() => setDraft(body)}
              disabled={busy}
            >
              {t("edit")}
            </button>
            <button
              type="button"
              className="text-xs text-muted hover:underline"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
            >
              {t("delete")}
            </button>
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
          </>
        ) : null}
        {failed ? <span className="text-xs text-danger">{t("actionFailed")}</span> : null}
      </div>
    </div>
  );
}
