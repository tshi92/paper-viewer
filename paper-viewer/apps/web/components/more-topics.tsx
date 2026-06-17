"use client";

import Link from "next/link";
import { useState } from "react";

export function MoreTopics({
  topics,
  topicCounts,
  currentTag,
  currentTime
}: {
  topics: string[];
  topicCounts: Record<string, number>;
  currentTag?: string;
  currentTime?: string;
}) {
  const [open, setOpen] = useState(false);

  function buildUrl(tag: string | null) {
    const p = new URLSearchParams();
    if (currentTime && currentTime !== "all") p.set("time", currentTime);
    if (tag) p.set("tag", tag);
    const qs = p.toString();
    return `/library${qs ? `?${qs}` : ""}`;
  }

  if (!open) {
    return (
      <button
        className="rounded bg-surface px-2 py-0.5 text-xs text-muted hover:bg-border"
        onClick={() => setOpen(true)}
      >
        More ({topics.length})
      </button>
    );
  }

  return (
    <>
      <button
        className="rounded bg-border px-2 py-0.5 text-xs text-muted"
        onClick={() => setOpen(false)}
      >
        Less ×
      </button>
      {topics.map((t) => {
        const isActive = currentTag === t;
        const count = topicCounts[t] ?? 0;
        return (
          <Link
            key={t}
            href={buildUrl(isActive ? null : t)}
            className={`rounded px-2 py-0.5 text-xs ${isActive ? "bg-accent text-white" : "bg-surface/50 text-muted hover:bg-border"}`}
          >
            {t} ({count}){isActive ? " ×" : ""}
          </Link>
        );
      })}
    </>
  );
}
