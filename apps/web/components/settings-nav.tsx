"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type SettingsNavItem = {
  href: string;
  label: string;
};

export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const pathname = usePathname();

  return (
    // A sidebar column on wide screens; on a phone the same items become a
    // wrapping tab row — every section stays visible (nothing hides behind a
    // sideways scroll), at the cost of a second line when space runs out.
    <nav className="flex flex-wrap gap-1 text-sm md:grid md:content-start">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "whitespace-nowrap rounded bg-surface px-3 py-2 font-medium text-accent"
                : "whitespace-nowrap rounded px-3 py-2 text-muted hover:bg-surface"
            }
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
