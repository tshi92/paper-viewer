"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";

export type RowMenuItem = {
  label: string;
  /** An action. Mutually exclusive with `href`. */
  onSelect?: () => void;
  /**
   * A destination, opened in a new tab. Items are plain data, so a server
   * component can hand the menu a set of outbound links — which an `onSelect`
   * callback could not cross.
   */
  href?: string;
  /** Small leading mark, e.g. a service's logo. */
  icon?: ReactNode;
  /** Renders in the danger colour; used for delete. */
  danger?: boolean;
};

/**
 * The per-row overflow menu (⋮) carrying a row's secondary actions — copy, edit
 * and delete on a comment; the outbound links on a catalog row.
 *
 * These used to sit inline as text buttons and icons, which put more chrome
 * than content on a row and gave every one of them a different visual weight.
 * The actions are unchanged; only their reveal is deferred.
 *
 * Keyboard: Escape closes and returns focus to the trigger, arrows move between
 * items, and an outside pointer-down closes without selecting.
 */
export function RowMenu({ items }: { items: RowMenuItem[] }) {
  const t = useTranslations("common");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

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
          {items.map((item, index) => {
            const className = `flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-xs transition-colors duration-150 hover:bg-surface ${
              item.danger ? "text-danger" : "text-ink"
            }`;
            function onKeyDown(event: KeyboardEvent<HTMLElement>) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(index, 1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(index, -1);
              }
            }
            const content = (
              <>
                {item.icon}
                {item.label}
              </>
            );
            return item.href ? (
              <a
                key={item.label}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                role="menuitem"
                href={item.href}
                target="_blank"
                rel="noopener noreferrer"
                className={className}
                onClick={() => close(false)}
                onKeyDown={onKeyDown}
              >
                {content}
              </a>
            ) : (
              <button
                key={item.label}
                ref={(node) => {
                  itemRefs.current[index] = node;
                }}
                type="button"
                role="menuitem"
                className={className}
                onClick={() => {
                  close(false);
                  item.onSelect?.();
                }}
                onKeyDown={onKeyDown}
              >
                {content}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
