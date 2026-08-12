"use client";

import { useEffect, useState, type ComponentType } from "react";

type RendererProps = { children: string; className?: string };

/**
 * Lazy front for MarkdownRenderer: react-markdown + remark-gfm are ~70KB gzip
 * and only matter once a chat/comment actually shows text, so the chunk loads
 * on first mount — the same policy the PDF annotator already follows. Until it
 * lands (and during SSR) the raw source renders as plain text, which for a
 * comment is perfectly readable.
 */
let loadedRenderer: ComponentType<RendererProps> | null = null;

export function MarkdownBody({
  children,
  className = "text-sm"
}: {
  children: string;
  /** Sets the base font size the relative element sizes hang off. */
  className?: string;
}) {
  const [Renderer, setRenderer] = useState<ComponentType<RendererProps> | null>(
    () => loadedRenderer
  );

  useEffect(() => {
    if (Renderer) return;
    let active = true;
    void import("./markdown-renderer").then((module) => {
      loadedRenderer = module.MarkdownRenderer;
      if (active) setRenderer(() => module.MarkdownRenderer);
    });
    return () => {
      active = false;
    };
  }, [Renderer]);

  if (!Renderer) {
    return <div className={`whitespace-pre-wrap ${className}`}>{children}</div>;
  }
  return <Renderer className={className}>{children}</Renderer>;
}
