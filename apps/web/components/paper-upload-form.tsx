"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "@/components/toast";
import { endFlight, setFlightProgress, startFlight, useFlight, useFlightProgress } from "@/lib/async-flight";
import { postWithProgress } from "@/lib/post-with-progress";
import { partRanges, UPLOAD_PART_BYTES } from "@/lib/upload-chunks";

/**
 * The processing flag lives in the module-level flight store, not component
 * state: metadata extraction takes tens of seconds and users navigate away in
 * the meantime — the button must still say "processing" when they come back.
 * Failures go through sticky toasts for the same reason.
 */
const UPLOAD_FLIGHT = "paper-upload";

type ReportFraction = (fraction: number) => void;

function sendFileWhole(file: File, report: ReportFraction): Promise<Response> {
  const formData = new FormData();
  formData.append("pdf", file);
  return postWithProgress("/api/papers", formData, (sentBytes) => report(sentBytes / file.size));
}

/**
 * Upload a file too large for one request: each part on its own, then a final
 * request that has the server join them. Resolves to the first failed
 * response, or to the final one.
 */
async function sendFileInParts(file: File, report: ReportFraction): Promise<Response> {
  const uploadId = crypto.randomUUID();
  const ranges = partRanges(file.size);

  for (const [index, range] of ranges.entries()) {
    const res = await postWithProgress(
      `/api/papers/upload-parts?uploadId=${uploadId}&index=${index}`,
      file.slice(range.start, range.end),
      (sentBytes) => report((range.start + sentBytes) / file.size),
      { "Content-Type": "application/octet-stream" }
    );
    if (!res.ok) return res;
  }

  return fetch("/api/papers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      upload: { id: uploadId, parts: ranges.length, fileName: file.name, contentType: file.type }
    })
  });
}

/**
 * `chunkedUpload` is set by the server on deployments whose host caps the
 * request body (see lib/upload-parts.ts); there, large files go up in parts.
 */
export function PaperUploadForm({ chunkedUpload = false }: { chunkedUpload?: boolean }) {
  const t = useTranslations("upload");
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const loading = useFlight(UPLOAD_FLIGHT);
  // A fraction while the file is going up; null while the server works on it
  // (and for a URL import, which has nothing to measure).
  const uploaded = useFlightProgress(UPLOAD_FLIGHT);
  const [url, setUrl] = useState("");

  function handleResult(data: { paperId?: string; duplicate?: boolean }) {
    if (!data.paperId) {
      router.refresh();
      return;
    }
    // A duplicate points at the library's existing row (with this PDF
    // attached when that row had none) — say so instead of silently landing there.
    if (data.duplicate) toast.info(t("duplicateMerged"));
    router.push(`/papers/${data.paperId}`);
  }

  async function handleFailure(res: Response) {
    const text = await res.text();
    let message = text || t("uploadFailed");
    try {
      // Structured errors carry a code the UI can turn into an actionable
      // hint; anything else stays the server's plain-text message.
      const body = JSON.parse(text) as { error?: string };
      if (body.error === "publisher_blocked") message = t("publisherBlocked");
    } catch {
      // plain-text error, keep as is
    }
    toast.error(message);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || loading) return;

    startFlight(UPLOAD_FLIGHT);

    try {
      // Once every byte is out, the server still has to read the PDF and
      // extract its metadata: from there the extent is unknown again.
      const report: ReportFraction = (fraction) =>
        setFlightProgress(UPLOAD_FLIGHT, fraction < 1 ? fraction : null);
      report(0);
      const send = chunkedUpload && file.size > UPLOAD_PART_BYTES ? sendFileInParts : sendFileWhole;
      const res = await send(file, report);
      setFlightProgress(UPLOAD_FLIGHT, null);
      if (res.ok) {
        handleResult((await res.json()) as { paperId?: string; duplicate?: boolean });
      } else {
        await handleFailure(res);
      }
    } catch {
      toast.error(t("uploadFailed"));
    } finally {
      endFlight(UPLOAD_FLIGHT);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleUrl() {
    const trimmed = url.trim();
    if (!trimmed || loading) return;

    startFlight(UPLOAD_FLIGHT);
    try {
      const res = await fetch("/api/papers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed })
      });
      if (res.ok) {
        handleResult((await res.json()) as { paperId?: string; duplicate?: boolean });
      } else {
        await handleFailure(res);
      }
    } catch {
      toast.error(t("urlFailed"));
    } finally {
      endFlight(UPLOAD_FLIGHT);
      setUrl("");
    }
  }

  return (
    // min-w-0 down the chain lets the URL input shrink on a phone; without it
    // the input's intrinsic width pushes the Add button off the screen.
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={handleFile} />
      <button
        // Outlined, like every other action in the app's chrome: this sits in a
        // header next to a text field, not at the end of a flow.
        // While busy the button is its own progress bar: a tint fills it from
        // the left as the file goes up, then pulses while the server works.
        className="relative shrink-0 overflow-hidden rounded border border-accent/40 px-3 py-1.5 text-sm font-medium text-accent transition-colors duration-150 hover:bg-accent/10 disabled:hover:bg-transparent"
        onClick={() => fileRef.current?.click()}
        disabled={loading}
        aria-busy={loading}
      >
        {loading && (
          <span
            role="progressbar"
            aria-label={uploaded === null ? t("processing") : t("uploading")}
            aria-valuemin={0}
            aria-valuemax={100}
            {...(uploaded === null ? {} : { "aria-valuenow": Math.round(uploaded * 100) })}
            className={`absolute inset-y-0 left-0 bg-accent/15 transition-[width] duration-200 ease-out ${
              uploaded === null ? "animate-pulse motion-reduce:animate-none" : ""
            }`}
            style={{ width: `${(uploaded ?? 1) * 100}%` }}
          />
        )}
        <span className="relative">
          {!loading ? t("uploadPdf") : uploaded === null ? t("processing") : t("uploading")}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
        <input
          type="text"
          className="w-56 min-w-0 flex-1 rounded border border-control px-2 py-1.5 text-sm placeholder:text-muted sm:flex-none"
          placeholder={t("urlPlaceholder")} aria-label={t("urlPlaceholder")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
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
    </div>
  );
}
