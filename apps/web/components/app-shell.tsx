import Link from "next/link";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Avatar } from "@/components/avatar";
import { TopNav } from "@/components/top-nav";
import type { CurrentUser } from "@/lib/auth";

export async function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  const t = await getTranslations("nav");
  const displayName = user.name ?? user.email;

  return (
    <div className="min-h-screen">
      {/* Sticky: on a long digest or a scrolled PDF the tabs stay reachable. */}
      <header className="sticky top-0 z-30 border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-2.5">
          <nav className="flex items-center gap-1 text-sm">
            <Link className="mr-3 font-semibold tracking-tight" href="/today">{t("brand")}</Link>
            <TopNav
              items={[
                { href: "/today", label: t("today") },
                { href: "/conferences", label: t("conferences") },
                { href: "/library", label: t("library") },
                { href: "/settings", label: t("settings") }
              ]}
            />
          </nav>
          <div className="flex items-center gap-2.5 text-sm text-muted">
            <Avatar name={user.name} email={user.email} size="md" />
            <span className="hidden sm:inline" title={user.email}>{displayName}</span>
            <form action="/api/auth/logout" method="post">
              <button
                className="rounded-md px-2.5 py-1.5 transition-colors duration-150 hover:bg-surface hover:text-ink"
                type="submit"
              >
                {t("signOut")}
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
