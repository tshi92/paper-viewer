import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Avatar } from "@/components/avatar";
import { MobileNav } from "@/components/mobile-nav";
import { TopNav } from "@/components/top-nav";
import type { CurrentUser } from "@/lib/auth";

export async function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const t = await getTranslations("nav");
  const displayName = user.name ?? user.email;
  const items = [
    { href: "/today", label: t("today") },
    { href: "/conferences", label: t("conferences") },
    { href: "/library", label: t("library") },
    { href: "/settings", label: t("settings") }
  ];

  return (
    <div className="min-h-screen">
      {/* Sticky: on a long digest or a scrolled PDF the tabs stay reachable. */}
      <header className="sticky top-0 z-30 border-b border-border bg-white">
        {/* One line at every width. Below `sm` the tab row and the sign-out
            button fold into the hamburger menu, leaving brand + avatar + ☰. */}
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5 sm:px-6">
          <div className="flex min-w-0 items-center text-sm">
            <Link className="mr-3 shrink-0 whitespace-nowrap font-semibold tracking-tight" href="/today">{t("brand")}</Link>
            <nav className="hidden items-center gap-1 sm:flex">
              <TopNav items={items} />
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-2.5 text-sm text-muted">
            <Avatar name={user.name} email={user.email} size="md" />
            {/* Truncated on a phone: the name stays visible next to the avatar
                without letting a long one crowd out the menu button. */}
            <span className="max-w-[7rem] truncate sm:max-w-none" title={user.email}>{displayName}</span>
            <form action="/api/auth/logout" method="post" className="hidden sm:block">
              <button
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 transition-colors duration-150 hover:bg-surface hover:text-ink"
                type="submit"
              >
                {t("signOut")}
              </button>
            </form>
            <MobileNav items={items} displayName={displayName} email={user.email} />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
