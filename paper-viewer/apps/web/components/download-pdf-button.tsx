"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DownloadPdfButton({ paperId, arxivId }: { paperId: string; arxivId: string }) {
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
      }
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
      {loading ? "Downloading..." : "Download PDF to server"}
    </button>
  );
}
