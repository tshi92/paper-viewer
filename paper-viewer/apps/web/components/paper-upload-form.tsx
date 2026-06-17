"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

export function PaperUploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const formData = new FormData();
    formData.append("pdf", file);

    try {
      const res = await fetch("/api/papers", { method: "POST", body: formData });
      if (res.ok) {
        const data = await res.json();
        if (data.paperId) {
          router.push(`/papers/${data.paperId}`);
          return;
        }
      }
      router.refresh();
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFile} />
      <button
        className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50"
        onClick={() => fileRef.current?.click()}
        disabled={loading}
      >
        {loading ? "Uploading..." : "Upload PDF"}
      </button>
    </>
  );
}
