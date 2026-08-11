"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";

export function MoreTopics({
  topics,
  topicCounts,
  currentTag,
  currentTime,
  currentQuery,
  currentLabel,
  currentState
}: {
  topics: string[];
  topicCounts: Record<string, number>;
  currentTag: string | undefined;
  currentTime: string | undefined;
  currentQuery: string | undefined;
  currentLabel: string | undefined;
  currentState: string | undefined;
}) {
  const t = useTranslations("library");
  const [open, setOpen] = useState(false);

  function buildUrl(tag: string | null) {
    const p = new URLSearchParams();
    if (currentTime && currentTime !== "all") p.set("time", currentTime);
    if (tag) p.set("tag", tag);
    if (currentLabel) p.set("label", currentLabel);
    if (currentState) p.set("state", currentState);
    if (currentQuery) p.set("q", currentQuery);
    const qs = p.toString();
    return `/library${qs ? `?${qs}` : ""}`;
  }

  if (!open) {
    return (
      <button
        className="rounded bg-surface px-2 py-0.5 text-xs text-muted hover:bg-border"
        onClick={() => setOpen(true)}
      >
        {t("moreTopics", { count: topics.length })}
      </button>
    );
  }

  return (
    <>
      <button
        className="rounded bg-border px-2 py-0.5 text-xs text-muted"
        onClick={() => setOpen(false)}
      >
        {t("lessTopics")}
      </button>
      {topics.map((topic) => {
        const isActive = currentTag === topic;
        const count = topicCounts[topic] ?? 0;
        return (
          <Link
            key={topic}
            href={buildUrl(isActive ? null : topic)}
            className={`rounded px-2 py-0.5 text-xs ${isActive ? "bg-accent text-white" : "bg-surface/50 text-muted hover:bg-border"}`}
          >
            {topic} ({count}){isActive ? " ×" : ""}
          </Link>
        );
      })}
    </>
  );
}
