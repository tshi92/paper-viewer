import Link from "next/link";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/lib/auth";

export function AppShell({ user, children }: { user: CurrentUser; children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          <nav className="flex items-center gap-5 text-sm">
            <Link className="font-semibold" href="/today">Paper Viewer</Link>
            <Link href="/today">Today</Link>
            <Link href="/library">Library</Link>
            <Link href="/settings">Settings</Link>
          </nav>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span>{user.email}</span>
            <form action="/api/auth/logout" method="post">
              <button className="rounded border border-border px-3 py-1" type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">{children}</main>
    </div>
  );
}
