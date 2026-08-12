"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type FilterOption = {
  /** Raw value, compared against the dropdown's current value. */
  value: string;
  label: string;
  /** Where picking this option navigates to; built by the page so every other filter param survives. */
  href: string;
  count?: number;
  /** Paper labels carry their own colour; rendered as a leading dot. */
  color?: string;
};

/**
 * The bidirectional 8×12 arrow HarnessKit stamps on every filter control — it reads
 * as "this cycles through values" rather than "this expands downwards".
 */
function SelectArrow() {
  return (
    <svg aria-hidden="true" width="8" height="12" viewBox="0 0 8 12" className="shrink-0 opacity-60">
      <path d="M4 1L7 4.5H1Z" fill="currentColor" />
      <path d="M4 11L1 7.5H7Z" fill="currentColor" />
    </svg>
  );
}

function CheckMark() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" className="ml-auto shrink-0">
      <path d="M2 6.5L4.5 9L10 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ColorDot({ color }: { color: string }) {
  return <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />;
}

/**
 * One filter of the library filter row, as a dropdown instead of a chip strip.
 *
 * Shape is borrowed from HarnessKit: a short bordered trigger that reads
 * `<prefix><current value>`, a small absolutely-positioned panel with a trailing
 * checkmark on the selected row, and counts folded into the option text.
 *
 * Options navigate rather than mutate state — each one carries a fully-built href,
 * so the page decides how the other query params are preserved.
 */
export function FilterDropdown({
  prefix,
  value,
  options
}: {
  /** Already ends with its locale's colon, e.g. `标签：` / `Labels:`. */
  prefix: string;
  value: string;
  options: FilterOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const foundIndex = options.findIndex((option) => option.value === value);
  const selectedIndex = foundIndex >= 0 ? foundIndex : 0;
  const selected = options[selectedIndex];
  // A filter is "on" whenever it is not sitting on its first (all) option.
  const isFiltering = selectedIndex > 0;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // Real DOM focus follows the active row, so Escape/Tab and screen readers behave
  // without an `aria-activedescendant` shadow cursor.
  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.focus();
  }, [open, activeIndex]);

  function openMenu() {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function closeMenu(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function handleTriggerKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      openMenu();
    }
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    switch (event.key) {
      case "Escape":
        event.preventDefault();
        closeMenu(true);
        break;
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, options.length - 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Tab":
        // Let focus leave naturally; the panel just gets out of the way.
        setOpen(false);
        break;
      default:
        break;
    }
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        className={`flex h-[26px] items-center gap-1.5 rounded border px-2 text-xs ${
          isFiltering ? "border-accent text-accent font-medium" : "border-border text-muted hover:bg-surface"
        }`}
      >
        <span className="text-muted">{prefix}</span>
        {selected?.color ? <ColorDot color={selected.color} /> : null}
        <span className="max-w-[8rem] truncate">{selected?.label ?? ""}</span>
        <SelectArrow />
      </button>

      {open ? (
        <div
          role="listbox"
          aria-label={prefix}
          onKeyDown={handleMenuKeyDown}
          className="absolute left-0 top-full z-50 mt-1 max-h-72 min-w-full overflow-y-auto rounded border border-border bg-white p-1 shadow-lg"
        >
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            return (
              <button
                key={option.value || "__all__"}
                type="button"
                role="option"
                aria-selected={isSelected}
                tabIndex={index === activeIndex ? 0 : -1}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                onClick={() => {
                  setOpen(false);
                  router.push(option.href);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                className="flex w-full items-center gap-2 whitespace-nowrap rounded px-2 py-1.5 text-xs text-ink hover:bg-surface focus:bg-surface"
              >
                {option.color ? <ColorDot color={option.color} /> : null}
                <span className="flex-1 text-left">
                  {option.label}
                  {option.count === undefined ? "" : ` (${option.count})`}
                </span>
                {isSelected ? <CheckMark /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
