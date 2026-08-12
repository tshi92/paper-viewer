"use client";

import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";

/**
 * App-wide transient feedback. A module-level store (no context) so any
 * client component — or non-React code — can fire `toast.success(...)`;
 * the container in the dashboard layout renders the stack. Success/info
 * dismiss themselves; errors stay until closed so they can actually be read.
 */
type ToastKind = "success" | "error" | "info";
type ToastItem = { id: number; kind: ToastKind; text: string };

const MAX_VISIBLE = 4;
const AUTO_DISMISS_MS = 3500;

let nextId = 1;
let items: readonly ToastItem[] = [];
const listeners = new Set<() => void>();
const EMPTY: readonly ToastItem[] = [];

function publish(next: readonly ToastItem[]): void {
  items = next;
  for (const listener of listeners) listener();
}

function push(kind: ToastKind, text: string): void {
  publish([...items.slice(-(MAX_VISIBLE - 1)), { id: nextId++, kind, text }]);
}

export function dismissToast(id: number): void {
  publish(items.filter((item) => item.id !== id));
}

export const toast = {
  success: (text: string) => push("success", text),
  error: (text: string) => push("error", text),
  info: (text: string) => push("info", text)
};

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const KIND_STYLES: Record<ToastKind, string> = {
  success: "border-success-border bg-success-surface text-success",
  error: "border-danger-border bg-danger-surface text-danger-deep",
  info: "border-accent/30 bg-white text-accent"
};

function ToastCard({ item }: { item: ToastItem }) {
  const t = useTranslations("common");

  useEffect(() => {
    if (item.kind === "error") return;
    const timer = setTimeout(() => dismissToast(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, item.kind]);

  return (
    <div
      role={item.kind === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex items-start gap-2 rounded border px-3 py-2.5 text-sm shadow-overlay animate-toast-in ${KIND_STYLES[item.kind]}`}
    >
      <span className="min-w-0 flex-1 break-words">{item.text}</span>
      <button
        type="button"
        aria-label={t("dismiss")}
        className="shrink-0 text-current opacity-60 transition-opacity duration-150 hover:opacity-100"
        onClick={() => dismissToast(item.id)}
      >
        ×
      </button>
    </div>
  );
}

export function ToastContainer() {
  const visible = useSyncExternalStore(
    subscribe,
    () => items,
    () => EMPTY
  );

  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 top-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {visible.map((item) => (
        <ToastCard key={item.id} item={item} />
      ))}
    </div>
  );
}
