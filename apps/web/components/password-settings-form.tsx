"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

type MessageKey =
  | "passwordMismatch"
  | "passwordTooShort"
  | "passwordIncorrect"
  | "passwordUnchanged"
  | "passwordSaveFailed";

/** The route names its refusals so the form can say which one it hit. */
const ERROR_MESSAGES: Record<string, MessageKey> = {
  incorrect: "passwordIncorrect",
  weak: "passwordTooShort",
  same: "passwordUnchanged"
};

type Outcome = { ok: true } | { ok: false; message: MessageKey };

/**
 * Changing your own password, for people who know their current one. The
 * reset-by-email flow next to it is for people who do not, and needs a mail
 * provider; this works on any deployment.
 */
export function PasswordSettingsForm() {
  const t = useTranslations("settingsGeneral");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function save() {
    if (saving) return;

    // Caught here rather than at the server: a mistyped confirmation is the
    // user contradicting themselves, and there is nothing to ask the server.
    if (newPassword !== confirmation) {
      setOutcome({ ok: false, message: "passwordMismatch" });
      return;
    }

    setSaving(true);
    setOutcome(null);

    try {
      const res = await fetch("/api/settings/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });

      if (res.ok) {
        setOutcome({ ok: true });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmation("");
        return;
      }

      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setOutcome({ ok: false, message: ERROR_MESSAGES[data?.error ?? ""] ?? "passwordSaveFailed" });
    } catch {
      setOutcome({ ok: false, message: "passwordSaveFailed" });
    } finally {
      setSaving(false);
    }
  }

  const complete = currentPassword.length > 0 && newPassword.length > 0 && confirmation.length > 0;

  return (
    <section className="mt-8 grid gap-4">
      <div>
        <h2 className="text-lg font-medium">{t("passwordHeading")}</h2>
        <p className="mt-1 text-sm text-muted">
          {t("passwordDescription", { min: MIN_PASSWORD_LENGTH })}
        </p>
      </div>
      <form
        className="grid max-w-sm gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="grid gap-1 text-sm" htmlFor="currentPassword">
          <span className="font-medium">{t("currentPasswordLabel")}</span>
          <input
            autoComplete="current-password"
            className="rounded border border-border px-3 py-2 text-sm"
            id="currentPassword"
            onChange={(event) => setCurrentPassword(event.target.value)}
            type="password"
            value={currentPassword}
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="newPassword">
          <span className="font-medium">{t("newPasswordLabel")}</span>
          <input
            autoComplete="new-password"
            className="rounded border border-border px-3 py-2 text-sm"
            id="newPassword"
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            value={newPassword}
          />
        </label>
        <label className="grid gap-1 text-sm" htmlFor="confirmPassword">
          <span className="font-medium">{t("confirmPasswordLabel")}</span>
          <input
            autoComplete="new-password"
            className="rounded border border-border px-3 py-2 text-sm"
            id="confirmPassword"
            onChange={(event) => setConfirmation(event.target.value)}
            type="password"
            value={confirmation}
          />
        </label>
        <button
          className="justify-self-start rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-transform duration-150 active:scale-[0.98] disabled:opacity-50"
          data-testid="password-save"
          disabled={saving || !complete}
          type="submit"
        >
          {t("passwordSave")}
        </button>
      </form>
      {outcome ? (
        outcome.ok ? (
          <p className="text-sm text-success" data-testid="password-save-result" role="status">
            {t("passwordSaved")}
          </p>
        ) : (
          <p className="text-sm text-danger" data-testid="password-save-result" role="alert">
            {t(outcome.message, { min: MIN_PASSWORD_LENGTH })}
          </p>
        )
      ) : null}
    </section>
  );
}
