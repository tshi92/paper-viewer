import { getTranslations } from "next-intl/server";

export default async function GeneralSettingsPage() {
  const t = await getTranslations("settingsGeneral");

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <p className="mt-6 rounded border border-border bg-white px-4 py-3 text-sm text-muted">
        {t("languageComingSoon")}
      </p>
    </div>
  );
}
