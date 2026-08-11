import type { ReactNode } from "react";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";
import { SettingsNav, type SettingsNavItem } from "@/components/settings-nav";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireCurrentUser();

  const items: SettingsNavItem[] = [
    { href: "/settings/general", label: "通用" },
    { href: "/settings/preferences", label: "Preferences" },
    { href: "/settings/llm", label: "LLM" }
  ];

  if (canManageWorkspaceSettings(user.role)) {
    items.push({ href: "/settings/members", label: "Members" });
  }

  return (
    <div className="grid grid-cols-[200px_1fr] gap-6">
      <SettingsNav items={items} />
      <div>{children}</div>
    </div>
  );
}
