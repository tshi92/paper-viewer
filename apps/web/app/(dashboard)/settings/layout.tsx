import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";
import { SettingsNav, type SettingsNavItem } from "@/components/settings-nav";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const user = await requireCurrentUser();
  const t = await getTranslations("settingsNav");

  // 排序按可编辑范围分组：先是人人可编辑的（通用、标签），再是管理员管理的。
  const items: SettingsNavItem[] = [
    { href: "/settings/general", label: t("general") },
    { href: "/settings/labels", label: t("labels") },
    { href: "/settings/preferences", label: t("preferences") },
    { href: "/settings/llm", label: t("llm") }
  ];

  if (canManageWorkspaceSettings(user.role)) {
    items.push({ href: "/settings/notifications", label: t("notifications") });
    items.push({ href: "/settings/members", label: t("members") });
  }

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
      <SettingsNav items={items} />
      <div>{children}</div>
    </div>
  );
}
