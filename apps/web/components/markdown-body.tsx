"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Sizes are relative (`em`) rather than absolute so the same component reads
 * correctly in the 360px sidebar at `text-sm` (discussion, chat) and at
 * `text-xs` (annotation threads); the caller sets the base size on `className`.
 *
 * Raw HTML is deliberately not enabled: react-markdown drops it unless
 * `rehype-raw` is added, which is what keeps user-authored comments from
 * injecting markup.
 */
const components: Components = {
  h1: ({ children }) => <h1 className="mt-3 text-[1.15em] font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mt-3 text-[1.08em] font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mt-2.5 font-semibold first:mt-0">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-2 font-semibold text-muted first:mt-0">{children}</h4>,
  h5: ({ children }) => <h5 className="mt-2 font-semibold text-muted first:mt-0">{children}</h5>,
  h6: ({ children }) => <h6 className="mt-2 font-semibold text-muted first:mt-0">{children}</h6>,
  p: ({ children }) => <p className="mt-2 leading-relaxed first:mt-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mt-2 list-disc space-y-0.5 pl-4 first:mt-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mt-2 list-decimal space-y-0.5 pl-4 first:mt-0">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mt-2 border-l-2 border-border pl-3 italic text-muted first:mt-0">
      {children}
    </blockquote>
  ),
  a: ({ children, href }) => (
    <a
      className="text-accent underline underline-offset-2"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code className="rounded bg-surface px-1 py-0.5 font-mono text-[0.9em]">{children}</code>
  ),
  // Fenced blocks nest a `code` inside; the descendant rules undo the inline chrome.
  pre: ({ children }) => (
    <pre className="mt-2 overflow-x-auto rounded border border-border bg-surface p-2 text-[0.85em] first:mt-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-[1em]">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="mt-2 overflow-x-auto first:mt-0">
      <table className="w-full border-collapse text-[0.95em]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-surface px-1.5 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="border border-border px-1.5 py-1">{children}</td>,
  hr: () => <hr className="my-3 border-border" />
};

export function MarkdownBody({
  children,
  className = "text-sm"
}: {
  children: string;
  /** Sets the base font size the relative element sizes hang off. */
  className?: string;
}) {
  return (
    <div className={className}>
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
