"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type TopNavItem = {
  href: string;
  label: string;
  /** Extra path prefixes that light this item up (e.g. /papers under 文库). */
  also?: string[];
};

/** Same active-state treatment as SettingsNav, lifted to the app header. */
export function TopNav({ items }: { items: TopNavItem[] }) {
  const pathname = usePathname();

  return (
    <>
      {items.map((item) => {
        const prefixes = [item.href, ...(item.also ?? [])];
        const isActive = prefixes.some(
          (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
        );
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={isActive ? "font-medium text-accent" : "text-muted hover:text-ink"}
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
