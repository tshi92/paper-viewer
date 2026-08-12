"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function PaperUploadForm() {
  const t = useTranslations("upload");
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError("");
    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const res = await fetch("/api/papers", { method: "POST", body: formData });
      if (res.ok) {
        const data = (await res.json()) as { paperId?: string };
        if (data.paperId) {
          router.push(`/papers/${data.paperId}`);
          return;
        }
      } else {
        setError(await res.text());
      }
      router.refresh();
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleUrl() {
    const trimmed = url.trim();
    if (!trimmed || loading) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed })
      });
      if (res.ok) {
        const data = (await res.json()) as { paperId?: string };
        if (data.paperId) {
          router.push(`/papers/${data.paperId}`);
          return;
        }
      } else {
        const text = await res.text();
        setError(text || t("urlFailed"));
      }
      router.refresh();
    } finally {
      setLoading(false);
      setUrl("");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFile} />
      <button
        className="shrink-0 rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        onClick={() => fileRef.current?.click()}
        disabled={loading}
      >
        {loading ? t("processing") : t("uploadPdf")}
      </button>
      <div className="flex items-center gap-1">
        <input
          type="text"
          className="w-56 rounded border border-control px-2 py-1.5 text-sm placeholder:text-muted"
          placeholder={t("urlPlaceholder")} aria-label={t("urlPlaceholder")}
          value={url}
          onChange={(e) => { setUrl(e.target.value); setError(""); }}
          onKeyDown={(e) => {
            // Skip the IME's confirm-candidate Enter (double-submit guard).
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter") handleUrl();
          }}
          disabled={loading}
        />
        <button
          className="shrink-0 rounded border border-border px-2.5 py-1.5 text-sm font-medium text-accent hover:bg-surface disabled:opacity-50"
          onClick={handleUrl}
          disabled={loading || !url.trim()}
        >
          {t("add")}
        </button>
      </div>
      {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
    </div>
  );
}
