"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "@/components/toast";

export function DownloadPdfButton({ paperId, arxivId }: { paperId: string; arxivId: string }) {
  const t = useTranslations("workspace");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    setLoading(true);
    try {
      const res = await fetch(`/api/papers/${paperId}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ arxivId })
      });

      if (res.ok) {
        router.refresh();
      } else {
        // A silent failure here hid "no storage configured" for a whole
        // production session; name the cause so the admin can act.
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(body.error ? `${t("downloadFailed")} (${body.error})` : t("downloadFailed"));
      }
    } catch {
      toast.error(t("downloadFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      className="rounded border border-border px-3 py-1.5 text-sm hover:bg-surface disabled:opacity-50"
      onClick={handleDownload}
      disabled={loading}
    >
      {loading ? t("downloadingPdf") : t("downloadPdf")}
    </button>
  );
}
