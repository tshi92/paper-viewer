"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

const LOCALE_COOKIE_NAME = "NEXT_LOCALE";
const COOKIE_MAX_AGE_SECONDS = 31536000;

export type LanguagePreference = "system" | "zh" | "en";

/** Option labels stay in their own language; only descriptions are translated. */
const NATIVE_LANGUAGE_NAME = { zh: "中文", en: "English" } as const;

function writeLocaleCookie(preference: LanguagePreference): void {
  if (preference === "system") {
    document.cookie = `${LOCALE_COOKIE_NAME}=; path=/; max-age=0`;
    return;
  }
  document.cookie = `${LOCALE_COOKIE_NAME}=${preference}; path=/; max-age=${COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
}

export function LanguageSettingsForm({ current }: { current: LanguagePreference }) {
  const t = useTranslations("settingsGeneral");
  const locale = useLocale();
  const router = useRouter();
  const [preference, setPreference] = useState<LanguagePreference>(current);

  function handleSelect(next: LanguagePreference) {
    if (next === preference) return;
    setPreference(next);
    writeLocaleCookie(next);
    router.refresh();
  }

  const options: Array<{ value: LanguagePreference; label: string; description: string }> = [
    { value: "system", label: t("languageSystemLabel"), description: t("languageSystemDescription") },
    { value: "zh", label: NATIVE_LANGUAGE_NAME.zh, description: t("languageZhDescription") },
    { value: "en", label: NATIVE_LANGUAGE_NAME.en, description: t("languageEnDescription") }
  ];

  const resolvedName = locale === "zh" ? NATIVE_LANGUAGE_NAME.zh : NATIVE_LANGUAGE_NAME.en;

  return (
    <section className="mt-6 grid gap-4">
      <div>
        <h2 className="text-lg font-medium">{t("languageHeading")}</h2>
        <p className="mt-1 text-sm text-muted">{t("languageDescription")}</p>
      </div>

      <div className="grid gap-2" data-testid="language-options" role="radiogroup" aria-label={t("languageHeading")}>
        {options.map((option) => {
          const isSelected = preference === option.value;
          return (
            <label
              className={
                isSelected
                  ? "flex cursor-pointer items-start gap-3 rounded border border-accent bg-surface px-4 py-3"
                  : "flex cursor-pointer items-start gap-3 rounded border border-border px-4 py-3 hover:bg-surface"
              }
              key={option.value}
            >
              <input
                checked={isSelected}
                className="mt-1"
                data-testid={`language-option-${option.value}`}
                name="language-preference"
                onChange={() => handleSelect(option.value)}
                type="radio"
                value={option.value}
              />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted">{option.description}</span>
              </span>
            </label>
          );
        })}
      </div>

      <p className="text-sm text-muted" data-testid="language-current">
        {t("languageCurrent", { language: resolvedName })}
      </p>
    </section>
  );
}
