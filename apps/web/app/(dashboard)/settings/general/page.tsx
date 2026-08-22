import { getTranslations } from "next-intl/server";
import { cookies } from "next/headers";
import { LOCALE_COOKIE_NAME } from "@/i18n/request";
import { requireCurrentUser } from "@/lib/auth";
import { LanguageSettingsForm, type LanguagePreference } from "@/components/language-settings-form";
import { PasswordSettingsForm } from "@/components/password-settings-form";
import { ProfileSettingsForm } from "@/components/profile-settings-form";

function toLanguagePreference(cookieValue: string | undefined): LanguagePreference {
  return cookieValue === "zh" || cookieValue === "en" ? cookieValue : "system";
}

export default async function GeneralSettingsPage() {
  const t = await getTranslations("settingsGeneral");
  const user = await requireCurrentUser();
  const cookieValue = (await cookies()).get(LOCALE_COOKIE_NAME)?.value;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <ProfileSettingsForm currentName={user.name} email={user.email} />
      <LanguageSettingsForm current={toLanguagePreference(cookieValue)} />
      <PasswordSettingsForm />
    </div>
  );
}
