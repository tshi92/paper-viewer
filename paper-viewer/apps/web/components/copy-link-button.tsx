"use client";

import { useState } from "react";

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      className="mt-2 rounded border border-border px-3 py-1 text-xs hover:bg-white"
      onClick={handleCopy}
      type="button"
    >
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
