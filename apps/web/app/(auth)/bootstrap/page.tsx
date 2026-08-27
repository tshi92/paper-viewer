import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { getTranslations } from "next-intl/server";

export default async function BootstrapPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations("auth");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{t("bootstrapTitle")}</h1>
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-deep"
        >
          {t("bootstrapError")}
        </p>
      ) : null}
      <form className="mt-6 grid gap-4" method="post" action="/api/bootstrap">
        <input className="rounded border border-control px-3 py-2" name="name" placeholder={t("namePlaceholder")} aria-label={t("namePlaceholder")} required />
        <input className="rounded border border-control px-3 py-2" name="email" placeholder={t("emailPlaceholder")} aria-label={t("emailPlaceholder")} type="email" required />
        <input className="rounded border border-control px-3 py-2" name="password" placeholder={t("passwordPlaceholder")} aria-label={t("passwordPlaceholder")} type="password" required minLength={MIN_PASSWORD_LENGTH} />
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">{t("bootstrapSubmit")}</button>
      </form>
    </main>
  );
}
