"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/toast";

/** Lets any member set the display name teammates see instead of the email. */
export function ProfileSettingsForm({ currentName }: { currentName: string | null }) {
  const t = useTranslations("settingsGeneral");
  const router = useRouter();
  const [name, setName] = useState(currentName ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      if (!res.ok) throw new Error("profile save failed");
      toast.success(t("profileSaved"));
      router.refresh();
    } catch {
      toast.error(t("profileSaveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-6 grid gap-4">
      <div>
        <h2 className="text-lg font-medium">{t("profileHeading")}</h2>
        <p className="mt-1 text-sm text-muted">{t("profileDescription")}</p>
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="grid flex-1 gap-1 text-sm">
          <span className="font-medium">{t("displayNameLabel")}</span>
          <input
            className="rounded border border-border px-3 py-2 text-sm"
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            type="text"
            value={name}
          />
        </label>
        <button
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-transform duration-150 active:scale-[0.98] disabled:opacity-50"
          disabled={saving || name.trim() === (currentName ?? "")}
          type="submit"
        >
          {t("profileSave")}
        </button>
      </form>
    </section>
  );
}
