import { getTranslations } from "next-intl/server";

export default async function LoginPage() {
  const t = await getTranslations("auth");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{t("signInTitle")}</h1>
      <form className="mt-6 grid gap-4" method="post" action="/api/auth/login">
        <input className="rounded border border-border px-3 py-2" name="email" placeholder={t("emailPlaceholder")} type="email" required />
        <input className="rounded border border-border px-3 py-2" name="password" placeholder={t("passwordPlaceholder")} type="password" required />
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">{t("signInSubmit")}</button>
      </form>
    </main>
  );
}
