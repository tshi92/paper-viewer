"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { TopNav, type TopNavItem } from "./top-nav";

/**
 * The hamburger menu that replaces the tab row below `sm`: the header keeps to
 * one line — brand, avatar, this button — however many sections the app grows,
 * and the tabs live in a dropdown underneath. Same items and active-state
 * treatment as the desktop row (it renders TopNav inside the panel), plus the
 * sign-out action, which the phone header has no room for either.
 *
 * Keyboard and pointer behaviour match RowMenu: Escape and outside taps close;
 * navigating away (pathname change) closes too, since the tap has landed.
 */
export function MobileNav({
  items,
  displayName,
  email
}: {
  items: TopNavItem[];
  /** Panel header: the phone header shows only the avatar, so the name lives here. */
  displayName: string;
  email: string;
}) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative sm:hidden" ref={containerRef}>
      <button
        type="button"
        aria-label={t("menu")}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
        onClick={() => setOpen((current) => !current)}
      >
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
          <line x1="3" y1="4.5" x2="15" y2="4.5" />
          <line x1="3" y1="9" x2="15" y2="9" />
          <line x1="3" y1="13.5" x2="15" y2="13.5" />
        </svg>
      </button>
      {open ? (
        <div className="absolute right-0 top-10 z-40 w-52 rounded-md bg-white py-2 shadow-overlay">
          <div className="border-b border-border px-4 pb-2">
            <p className="truncate text-sm font-medium text-ink">{displayName}</p>
            {email !== displayName ? <p className="truncate text-xs text-muted">{email}</p> : null}
          </div>
          <nav className="mt-2 grid gap-0.5 px-2 text-sm">
            <TopNav items={items} />
          </nav>
          <div className="mt-2 border-t border-border px-2 pt-2">
            <form action="/api/auth/logout" method="post">
              <button
                className="w-full rounded-md px-2.5 py-1.5 text-left text-sm text-muted transition-colors duration-150 hover:bg-surface hover:text-ink"
                type="submit"
              >
                {t("signOut")}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
