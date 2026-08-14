import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { resolvePasswordReset } from "@/lib/password-reset";

/**
 * Sets a new password from a mailed link.
 *
 * The link is checked before the form is shown, so an expired or already-used
 * one says so up front instead of after typing a password. Unknown, used and
 * expired all read the same: distinguishing them only helps someone probing
 * tokens.
 */
export default async function ResetPasswordPage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations("auth");
  const { token } = await params;
  const { error } = await searchParams;
  const reset = await resolvePasswordReset(token);

  if (!reset) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
        <h1 className="text-2xl font-semibold">{t("resetInvalidTitle")}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{t("resetInvalidBody")}</p>
        <Link className="mt-6 text-sm text-accent hover:underline" href="/forgot-password">
          {t("forgotSubmit")}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">{t("resetTitle")}</h1>
      {error === "weak" ? (
        <p
          role="alert"
          className="mt-4 rounded border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-deep"
        >
          {t("resetTooShort")}
        </p>
      ) : null}
      <form className="mt-6 grid gap-4" method="post" action="/api/auth/reset-password">
        <input type="hidden" name="token" value={token} />
        <input
          className="rounded border border-control px-3 py-2"
          name="password"
          placeholder={t("newPasswordPlaceholder")}
          aria-label={t("newPasswordPlaceholder")}
          type="password"
          minLength={12}
          required
        />
        <p className="text-xs text-muted">{t("passwordRule")}</p>
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">
          {t("resetSubmit")}
        </button>
      </form>
    </main>
  );
}
