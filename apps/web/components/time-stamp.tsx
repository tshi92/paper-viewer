"use client";

import { useLocale } from "next-intl";

/** Small locale-aware date+time, the one way an item's moment is rendered. */
export function TimeStamp({
  value,
  className = "text-[11px] text-muted"
}: {
  value: string | Date;
  className?: string;
}) {
  const locale = useLocale();
  const date = typeof value === "string" ? new Date(value) : value;
  return (
    <time dateTime={date.toISOString()} className={`whitespace-nowrap ${className}`}>
      {new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date)}
    </time>
  );
}
