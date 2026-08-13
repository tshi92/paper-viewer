"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

export type RowMenuItem = {
  label: string;
  onSelect: () => void;
  /** Renders in the danger colour; used for delete. */
  danger?: boolean;
};

/**
 * The per-row overflow menu (⋮) carrying a row's secondary actions — copy,
 * edit, delete.
 *
 * These used to sit inline as three text buttons under every comment, which put
 * more chrome than content on a short reply and made a thread hard to scan. The
 * actions are unchanged; only their reveal is deferred.
 *
 * Keyboard: Escape closes and returns focus to the trigger, arrows move between
 * items, and an outside pointer-down closes without selecting.
 */
export function RowMenu({ items }: { items: RowMenuItem[] }) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Focus lands on the first item so the menu is operable without a mouse.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus();
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function moveFocus(from: number, delta: number) {
    const next = (from + delta + items.length) % items.length;
    itemRefs.current[next]?.focus();
  }

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("moreActions")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
        onClick={(event) => {
          // The card around this menu selects itself on click; the menu's own
          // clicks are not that.
          event.stopPropagation();
          setOpen((it) => !it);
        }}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <circle cx="7" cy="2.5" r="1.25" />
          <circle cx="7" cy="7" r="1.25" />
          <circle cx="7" cy="11.5" r="1.25" />
        </svg>
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-7 z-20 min-w-[7rem] overflow-hidden rounded-md bg-white py-1 shadow-overlay"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              close(true);
            }
          }}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role="menuitem"
              className={`block w-full px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-surface ${
                item.danger ? "text-danger" : "text-ink"
              }`}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  moveFocus(index, 1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  moveFocus(index, -1);
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
