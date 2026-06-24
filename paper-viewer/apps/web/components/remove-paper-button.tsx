"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function RemovePaperButton({ workspacePaperId }: { workspacePaperId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);

  async function handleRemove() {
    await fetch(`/api/papers/${workspacePaperId}/remove`, { method: "POST" });
    router.refresh();
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <button
          className="rounded bg-red-600 px-2 py-1 text-xs text-white"
          onClick={handleRemove}
        >
          Confirm
        </button>
        <button
          className="rounded border border-border px-2 py-1 text-xs"
          onClick={() => setConfirming(false)}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      className="shrink-0 rounded border border-border px-2 py-1 text-xs text-muted opacity-0 group-hover:opacity-100 hover:border-red-300 hover:text-red-600"
      onClick={() => setConfirming(true)}
    >
      Remove
    </button>
  );
}
