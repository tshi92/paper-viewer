import { getRequestConfig } from "next-intl/server";
import { cookies, headers } from "next/headers";

export const locales = ["zh", "en"] as const;
export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "en";
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

function isAppLocale(value: string | undefined): value is AppLocale {
  return value === "zh" || value === "en";
}

/**
 * Picks the first supported locale from an `Accept-Language` header,
 * honouring the quality values used to order the client's preferences.
 */
export function matchAcceptLanguage(acceptLanguage: string): AppLocale {
  const preferences = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag = "", ...params] = part.trim().split(";");
      const quality = params
        .map((param) => param.trim())
        .find((param) => param.startsWith("q="));
      return {
        language: tag.trim().toLowerCase(),
        quality: quality ? Number.parseFloat(quality.slice(2)) : 1
      };
    })
    .filter((preference) => preference.language.length > 0 && !Number.isNaN(preference.quality))
    .sort((a, b) => b.quality - a.quality);

  for (const { language } of preferences) {
    if (language === "*") return defaultLocale;
    const base = language.split("-")[0];
    if (isAppLocale(base)) return base;
  }

  return defaultLocale;
}

/** Cookie wins over the browser preference; "system" (or absent) follows the browser. */
export async function resolveLocale(): Promise<AppLocale> {
  const cookieValue = (await cookies()).get(LOCALE_COOKIE_NAME)?.value;
  if (isAppLocale(cookieValue)) return cookieValue;

  const acceptLanguage = (await headers()).get("accept-language") ?? "";
  return matchAcceptLanguage(acceptLanguage);
}

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default
  };
});
