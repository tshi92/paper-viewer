import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Asks for the account's address and, if it exists, mails a reset link.
 *
 * The confirmation is deliberately the same whether or not an account was
 * found — this page is reachable without logging in, and a "no such user"
 * would turn it into an account enumeration oracle.
 */
export default async function ForgotPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const t = await getTranslations("auth");
  const { state } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{t("forgotTitle")}</h1>

      {state === "sent" ? (
        <p
          role="status"
          className="mt-4 rounded border border-border bg-surface px-3 py-2 text-sm leading-relaxed text-muted"
        >
          {t("forgotSent")}
        </p>
      ) : state === "unavailable" ? (
        <p
          role="alert"
          className="mt-4 rounded border border-danger-border bg-danger-surface px-3 py-2 text-sm leading-relaxed text-danger-deep"
        >
          {t("forgotUnavailable")}
        </p>
      ) : (
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("forgotBody")}</p>
      )}

      {state === "sent" ? null : (
        <form className="mt-6 grid gap-4" method="post" action="/api/auth/forgot-password">
          <input
            className="rounded border border-control px-3 py-2"
            name="email"
            placeholder={t("emailPlaceholder")}
            aria-label={t("emailPlaceholder")}
            type="email"
            required
          />
          <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">
            {t("forgotSubmit")}
          </button>
        </form>
      )}

      <Link className="mt-6 text-sm text-accent hover:underline" href="/login">
        {t("backToSignIn")}
      </Link>
    </main>
  );
}
