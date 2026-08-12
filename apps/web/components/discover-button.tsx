"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/toast";

/**
 * Kicks off the digest pipeline. Failures go to the global toast stack (it
 * lives in the layout and error toasts stay until dismissed), because an
 * inline message under this button vanished as soon as the user switched
 * pages — which made an instant failure indistinguishable from a run in
 * progress. Mid-run state is carried by the server-derived progress banner.
 */
export function DiscoverButton() {
  const t = useTranslations("home");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDiscover() {
    setLoading(true);

    try {
      const res = await fetch("/api/papers/discover", { method: "POST" });
      const text = await res.text();

      let data: { error?: string };
      try {
        data = JSON.parse(text);
      } catch {
        toast.error(text || t("discoverServerError"));
        return;
      }

      if (!res.ok) {
        toast.error(data.error ?? t("discoverFailed"));
        return;
      }

      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("discoverNetworkError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className="rounded bg-accent transition-transform duration-150 active:scale-[0.98] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      onClick={handleDiscover}
      disabled={loading}
    >
      {loading ? t("discovering") : t("discover")}
    </button>
  );
}
