import { createHash } from "node:crypto";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { prisma } from "@paper-viewer/db";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

/**
 * The first screen anyone outside the workspace ever sees, so it carries the
 * app's own surface — a white card on the canvas ground — rather than the bare
 * form the other auth pages use.
 *
 * The invitation is resolved here rather than only at submit time. Two things
 * follow from that: the address the account will be created with can be shown
 * (it comes from the invitation and is not the invitee's to change), and a
 * spent or expired link says so up front instead of after a filled-in form.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const ERROR_KEYS: Record<string, "inviteErrorMismatch" | "inviteErrorWeak" | "inviteErrorTaken" | "inviteErrorGeneric"> = {
  mismatch: "inviteErrorMismatch",
  weak: "inviteErrorWeak",
  taken: "inviteErrorTaken",
  invalid: "inviteErrorGeneric"
};

const fieldClass =
  "rounded border border-control bg-white px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent";

export default async function InvitePage({
  params,
  searchParams
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const { error } = await searchParams;
  const t = await getTranslations("auth");

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { workspace: { select: { name: true } } }
  });

  // Spent, expired and never-existed are one state on purpose: telling them
  // apart only helps someone probing tokens.
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
        <h1 className="rise text-[clamp(1.5rem,3vw,1.875rem)] font-semibold leading-[1.3] tracking-tight">
          {t("inviteInvalidTitle")}
        </h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">{t("inviteInvalidBody")}</p>
        <Link className="mt-6 self-start text-sm text-accent hover:underline" href="/login">
          {t("backToSignIn")}
        </Link>
      </main>
    );
  }

  const errorKey = error ? ERROR_KEYS[error] ?? "inviteErrorGeneric" : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-16">
      {/* One sentence carries the welcome, the workspace and the product, so
          the page opens by saying where you are rather than stacking a
          wordmark on top of a greeting. */}
      <h1 className="rise text-balance text-[clamp(1.75rem,4vw,2.125rem)] font-semibold leading-[1.45] tracking-tight">
        {t.rich("inviteHeading", {
          workspace: invitation.workspace.name,
          // Serif italic against the interface sans: the workspace reads as a
          // name, not a label. Optically a touch larger — serif x-heights sit
          // below Inter's at a shared size.
          name: (chunks) => (
            <span className="whitespace-nowrap font-serif text-[1.06em] italic">{chunks}</span>
          ),
          // Both names stay whole: a heading that breaks "Paper / Viewer"
          // across lines reads as two words rather than one product.
          product: (chunks) => <span className="whitespace-nowrap">{chunks}</span>
        })}
      </h1>
      {/* 1.85 rather than 1.625: the looser measure onboarding uses for its
          supporting copy, which reads as considered rather than packed. */}
      <p
        className="rise mt-4 text-[15px] leading-[1.85] text-muted"
        style={{ animationDelay: "70ms" }}
      >
        {t("inviteSubtitle")}
      </p>

      {errorKey ? (
        <p
          role="alert"
          className="mt-8 max-w-sm rounded border border-danger-border bg-danger-surface px-3 py-2 text-sm text-danger-deep"
        >
          {t(errorKey, { min: MIN_PASSWORD_LENGTH })}
        </p>
      ) : null}

      {/* Narrower than the heading above it: a password field the width of a
          headline reads as a mistake, and the offset is the composition. */}
      <form
        action={`/api/invitations/${token}/accept`}
        className="rise mt-9 grid max-w-sm gap-5"
        method="post"
        style={{ animationDelay: "140ms" }}
      >
        <div className="grid gap-1.5">
          <span className="text-sm font-medium" id="accountEmailLabel">
            {t("accountEmailLabel")}
          </span>
          {/* Shown, not offered: the account is created with the address the
              invitation was sent to, so a field here would be one the server
              ignores. It keeps the geometry of the inputs below but drops
              their white fill and firm outline — bare text in that slot reads
              as a field that lost its box, rather than a value that is fixed. */}
          <p
            aria-labelledby="accountEmailLabel"
            className="rounded border border-border bg-surface px-3 py-2 text-sm text-muted"
          >
            {invitation.email}
          </p>
        </div>

        <div className="grid gap-1.5">
          <label className="text-sm font-medium" htmlFor="name">
            {t("displayNameLabel")}
          </label>
          <input
            autoComplete="name"
            className={fieldClass}
            id="name"
            maxLength={80}
            name="name"
            required
            type="text"
          />
        </div>

        <div className="grid gap-1.5">
          <label className="text-sm font-medium" htmlFor="password">
            {t("passwordPlaceholder")}
          </label>
          <input
            aria-describedby="passwordRule"
            autoComplete="new-password"
            className={fieldClass}
            id="password"
            minLength={MIN_PASSWORD_LENGTH}
            name="password"
            required
            type="password"
          />
          {/* Described by, not labelled by: inside the label this became part
              of the field's name, which read as "密码至少 8 位。". */}
          <span className="text-xs text-muted" id="passwordRule">
            {t("passwordRule", { min: MIN_PASSWORD_LENGTH })}
          </span>
        </div>

        <div className="grid gap-1.5">
          <label className="text-sm font-medium" htmlFor="confirmPassword">
            {t("confirmPasswordLabel")}
          </label>
          <input
            autoComplete="new-password"
            className={fieldClass}
            id="confirmPassword"
            minLength={MIN_PASSWORD_LENGTH}
            name="confirmPassword"
            required
            type="password"
          />
        </div>

        {/* The shadow is tinted with the button's own colour rather than a
            neutral drop, so the lift belongs to the button instead of sitting
            under it — the one flourish on the page, on its one action. */}
        <button
          className="mt-2 flex w-full items-center justify-center gap-2 rounded bg-accent px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-accent/25 transition-all duration-200 hover:shadow-xl hover:shadow-accent/30 active:scale-[0.99] sm:w-auto sm:justify-self-start"
          type="submit"
        >
          {t("inviteSubmit")}
          <svg
            aria-hidden="true"
            className="opacity-60"
            fill="none"
            height="15"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
            width="15"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
    </main>
  );
}
