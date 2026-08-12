import { getTranslations } from "next-intl/server";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations("auth");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{t("signInTitle")}</h1>
      {error ? (
        <p
          role="alert"
          className="mt-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600"
        >
          {t("loginError")}
        </p>
      ) : null}
      <form className="mt-6 grid gap-4" method="post" action="/api/auth/login">
        <input className="rounded border border-border px-3 py-2" name="email" placeholder={t("emailPlaceholder")} type="email" required />
        <input className="rounded border border-border px-3 py-2" name="password" placeholder={t("passwordPlaceholder")} type="password" required />
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">{t("signInSubmit")}</button>
      </form>
    </main>
  );
}
