"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DiscoverButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDiscover() {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/papers/discover", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Discovery failed");
        return;
      }

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
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
        {loading ? "Discovering..." : "Discover papers"}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
