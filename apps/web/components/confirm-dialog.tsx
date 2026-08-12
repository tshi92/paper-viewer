"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * In-app replacement for window.confirm so every destructive flow shares one
 * look. Escape and the backdrop cancel; focus lands on the confirm button on
 * open and returns to the previously focused element on close. With only two
 * focusable controls, a manual Tab cycle is enough to keep focus inside.
 */
export function ConfirmDialog({
  open,
  message,
  confirmLabel,
  destructive = true,
  busy = false,
  onConfirm,
  onCancel
}: {
  open: boolean;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("common");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const messageId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  // Portalled to <body>: rendered in place, the sticky sidebar's stacking
  // context would flatten the overlay's z-index and let the PDF's own layers
  // (textLayer z-2 in the root context) paint straight over the dialog.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={onCancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
          return;
        }
        if (event.key === "Tab") {
          event.preventDefault();
          const next =
            document.activeElement === confirmRef.current ? cancelRef.current : confirmRef.current;
          next?.focus();
        }
      }}
    >
      {/* Named by the action, described by the visible message — pointing the
          name at the message too would make screen readers read it twice. */}
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={confirmLabel}
        aria-describedby={messageId}
        className="w-full max-w-sm rounded border border-border bg-white p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <p id={messageId} className="text-sm leading-relaxed">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            className="rounded border border-border px-3 py-1.5 text-sm disabled:opacity-50"
            onClick={onCancel}
            disabled={busy}
          >
            {t("cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`rounded px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${
              destructive ? "bg-danger" : "bg-accent"
            }`}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
