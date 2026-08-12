"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

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

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => previous?.focus();
  }, [open]);

  if (!open) return null;

  return (
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
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={message}
        className="w-full max-w-sm rounded border border-border bg-white p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="text-sm leading-relaxed">{message}</p>
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
    </div>
  );
}
