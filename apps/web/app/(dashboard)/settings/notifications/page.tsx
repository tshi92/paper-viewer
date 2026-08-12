import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";
import { NotificationSettingsForm } from "@/components/notification-settings-form";

export default async function NotificationSettingsPage() {
  const user = await requireCurrentUser();
  const t = await getTranslations("settingsNotifications");

  // Members have nothing readable here (unlike research preferences), so send them
  // straight back to the general settings.
  if (!canManageWorkspaceSettings(user.role)) {
    redirect("/settings/general");
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("description")}</p>
      <NotificationSettingsForm />
    </div>
  );
}
