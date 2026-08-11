import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";
import { SettingsNav, type SettingsNavItem } from "@/components/settings-nav";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireCurrentUser();
  const t = await getTranslations("settingsNav");

  const items: SettingsNavItem[] = [
    { href: "/settings/general", label: t("general") },
    { href: "/settings/preferences", label: t("preferences") },
    { href: "/settings/llm", label: t("llm") }
  ];

  if (canManageWorkspaceSettings(user.role)) {
    items.push({ href: "/settings/notifications", label: t("notifications") });
    items.push({ href: "/settings/members", label: t("members") });
  }

  return (
    <div className="grid grid-cols-[200px_1fr] gap-6">
      <SettingsNav items={items} />
      <div>{children}</div>
    </div>
  );
}
