"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export type TopNavItem = {
  href: string;
  label: string;
};

/** Which tab a paper page belongs to, from its ?from= param. */
const PAPER_SECTIONS: Record<string, string> = {
  today: "/today",
  conferences: "/conferences",
  library: "/library"
};

/** Same active-state treatment as SettingsNav, lifted to the app header. */
export function TopNav({ items }: { items: TopNavItem[] }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // A paper page highlights the tab it was opened from (?from=), not Library
  // unconditionally: a conference paper someone previews is not in the library
  // yet. Library stays the default for links that carry no origin.
  const onPaperPage = pathname === "/papers" || pathname.startsWith("/papers/");
  const paperSection = onPaperPage
    ? (PAPER_SECTIONS[searchParams.get("from") ?? ""] ?? "/library")
    : null;

  return (
    <>
      {items.map((item) => {
        const isActive = paperSection
          ? item.href === paperSection
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            // A tinted pill instead of only a color change: on a four-item bar
            // the active tab should be findable without comparing shades.
            // nowrap + shrink-0: the header scrolls sideways on a phone instead
            // of letting labels break mid-word.
            className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors duration-150 ${
              isActive
                ? "bg-accent/10 font-medium text-accent"
                : "text-muted hover:bg-surface hover:text-ink"
            }`}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
