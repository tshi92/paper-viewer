"use client";

export function PdfViewer({ paperId }: { paperId: string }) {
  return (
    <iframe
      className="h-[calc(100vh-180px)] w-full rounded border border-border bg-white"
      src={`/api/papers/${paperId}/file`}
      title="Paper PDF"
    />
  );
}
