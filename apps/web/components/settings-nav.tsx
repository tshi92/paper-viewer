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
    <nav className="grid content-start gap-1 text-sm">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={
              isActive
                ? "rounded bg-surface px-3 py-2 font-medium text-accent"
                : "rounded px-3 py-2 text-muted hover:bg-surface"
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
