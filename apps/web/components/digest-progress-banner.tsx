"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const POLL_MS = 5_000;

/**
 * Server-derived "digest is being generated" banner. The pipeline runs on the
 * server and survives navigation; only the Discover button's local spinner
 * used to carry that fact, so leaving the page made the run look lost. This
 * banner is rendered whenever today's digest still has pending papers and
 * refreshes the page until the run completes.
 *
 * When `stalled` is set, the previous run died without finishing (serverless
 * functions get hard-killed at their time limit). The banner then drives the
 * run forward itself: POST /api/papers/discover resumes the pending queue, and
 * each resume processes as many papers as fit in one function invocation. The
 * digest lock makes concurrent tabs harmless.
 */
export function DigestProgressBanner({
  done,
  total,
  stalled
}: {
  done: number;
  total: number;
  stalled: boolean;
}) {
  const t = useTranslations("home");
  const router = useRouter();
  const resuming = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [router]);

  useEffect(() => {
    if (!stalled) return;
    let cancelled = false;
    const resume = () => {
      if (cancelled || resuming.current) return;
      resuming.current = true;
      void fetch("/api/papers/discover", { method: "POST" })
        .catch(() => undefined)
        .finally(() => {
          resuming.current = false;
          if (!cancelled) router.refresh();
        });
    };
    resume();
    // Retry on an interval rather than on prop changes: a resume attempt that
    // fails outright leaves done/total untouched, and the banner must not need
    // changing props to try again. While a resume runs, the server lock makes
    // `stalled` flip false, unmounting this effect; the in-flight request
    // keeps going and the next stale render re-arms it.
    const timer = setInterval(resume, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stalled, router]);

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded border border-accent/30 bg-white px-4 py-3 text-sm shadow-card"
    >
      <span
        aria-hidden
        className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
      />
      <span>
        {total > 0 ? t("digestRunningProgress", { done, total }) : t("digestRunning")}
      </span>
    </div>
  );
}
