"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

const POLL_MS = 5_000;

/**
 * Server-derived "digest is being generated" banner. The pipeline runs on the
 * server and survives navigation; only the Discover button's local spinner
 * used to carry that fact, so leaving the page made the run look lost. This
 * banner is rendered whenever today's digest still has pending papers and
 * refreshes the page until the run completes.
 */
export function DigestProgressBanner() {
  const t = useTranslations("home");
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded border border-accent/30 bg-white px-4 py-3 text-sm shadow-card"
    >
      <span
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
      />
      <span>{t("digestRunning")}</span>
    </div>
  );
}
