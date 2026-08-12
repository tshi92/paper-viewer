"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DiscoverButton() {
  const t = useTranslations("home");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDiscover() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/papers/discover", { method: "POST" });
      const text = await res.text();

      let data: { error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        setError(text || t("discoverServerError"));
        return;
      }

      if (!res.ok) {
        setError(data.error ?? t("discoverFailed"));
        return;
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("discoverNetworkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        onClick={handleDiscover}
        disabled={loading}
      >
        {loading ? t("discovering") : t("discover")}
      </button>
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
