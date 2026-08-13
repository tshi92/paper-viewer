"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { toast } from "@/components/toast";
import { endFlight, startFlight, useFlight } from "@/lib/async-flight";

/**
 * Kicks off the digest pipeline. Failures go to the global toast stack (it
 * lives in the layout and error toasts stay until dismissed), because an
 * inline message under this button vanished as soon as the user switched
 * pages — which made an instant failure indistinguishable from a run in
 * progress.
 *
 * The in-flight flag lives in the module-level flight store rather than in
 * component state for the same reason. A run's first minutes are spent
 * fetching arXiv and asking the model which papers to pick, and only then does
 * the DailyDigest row that drives the progress banner exist — so between the
 * click and that row there is nothing on the server for the page to show.
 * Navigating away and back used to land in exactly that window and show an idle
 * button, with no way to tell whether the run had been interrupted.
 */
const FLIGHT_KEY = "digest:discover";

export function DiscoverButton() {
  const t = useTranslations("home");
  const router = useRouter();
  const loading = useFlight(FLIGHT_KEY);

  async function handleDiscover() {
    if (loading) return;
    startFlight(FLIGHT_KEY);

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
      // Runs even if this component was unmounted mid-request: the async
      // function owns the flag, not the mount.
      endFlight(FLIGHT_KEY);
    }
  }

  return (
    <button
      // Outlined like its neighbour: this is a manual top-up of something that
      // already runs on a schedule, not the page's primary action, and a solid
      // block was the loudest thing on a page whose point is the briefing.
      className="rounded border border-accent/40 px-4 py-2 text-sm font-medium text-accent transition-colors duration-150 hover:bg-accent/10 disabled:opacity-50"
      onClick={handleDiscover}
      disabled={loading}
    >
      {loading ? t("discovering") : t("discover")}
    </button>
  );
}
