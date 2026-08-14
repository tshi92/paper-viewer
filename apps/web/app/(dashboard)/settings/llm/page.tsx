import { getTranslations } from "next-intl/server";
import { AdminOnlyNote } from "@/components/admin-only-note";
import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { requireCurrentUser } from "@/lib/auth";
import { LlmSettingsForm } from "@/components/llm-settings-form";

export default async function LlmSettingsPage() {
  const user = await requireCurrentUser();
  const t = await getTranslations("settingsLlm");

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <AdminOnlyNote />
      <p className="mt-2 text-sm text-muted">{t("description")}</p>

      {canManageWorkspaceSettings(user.role) ? (
        <LlmSettingsForm />
      ) : (
        <p className="mt-6 rounded border border-border bg-surface px-4 py-3 text-sm text-muted">
          {t("adminOnly")}
        </p>
      )}
    </div>
  );
}
