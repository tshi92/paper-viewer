import { getTranslations } from "next-intl/server";
import { requireCurrentUser } from "@/lib/auth";
import { LabelSettings } from "@/components/label-settings";

export default async function LabelSettingsPage() {
  // Every workspace member may manage labels, so membership is the only gate.
  await requireCurrentUser();
  const t = await getTranslations("settingsLabels");

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("description")}</p>
      <LabelSettings />
    </div>
  );
}
