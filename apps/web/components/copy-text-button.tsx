"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Copies the raw markdown source, not the rendered text, so a pasted chat reply
 * or comment keeps its headings, lists and code fences.
 */
export function CopyTextButton({
  text,
  className = "text-xs text-muted hover:underline"
}: {
  text: string;
  /** Overridden on the accent-coloured chat bubbles, where `text-muted` disappears. */
  className?: string;
}) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // A denied clipboard permission is not worth an error banner.
    }
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => void handleCopy()}
    >
      {copied ? t("copied") : t("copy")}
    </button>
  );
}
