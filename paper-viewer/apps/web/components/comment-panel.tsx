"use client";

import { useRouter } from "next/navigation";
import { useRef, useEffect } from "react";

type CommentView = {
  id: string;
  body: string;
  pageNumber: number | null;
  quotedText: string | null;
  createdAt: Date;
  author: {
    email: string;
    name: string | null;
  };
};

export function CommentPanel({
  paperId,
  comments,
  pendingQuote
}: {
  paperId: string;
  comments: CommentView[];
  pendingQuote?: { text: string; pageNumber: number } | null;
}) {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (pendingQuote && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [pendingQuote]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const formData = new FormData(form);

    await fetch(`/api/papers/${paperId}/comments`, {
      method: "POST",
      body: formData
    });

    form.reset();
    router.refresh();
  }

  return (
    <section className="rounded border border-border bg-white">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">Discussion</h2>
      </div>
      <div className="max-h-96 divide-y divide-border overflow-auto">
        {comments.map((comment) => (
          <article className="px-4 py-3" key={comment.id}>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{comment.author.name ?? comment.author.email}</span>
              {comment.pageNumber ? (
                <span className="rounded bg-surface px-1.5 py-0.5">p.{comment.pageNumber}</span>
              ) : null}
            </div>
            {comment.quotedText ? (
              <blockquote className="mt-1.5 border-l-2 border-accent/30 pl-3 text-xs italic text-muted">
                &ldquo;{comment.quotedText}&rdquo;
              </blockquote>
            ) : null}
            <p className="mt-1.5 text-sm">{comment.body}</p>
          </article>
        ))}
        {comments.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No comments yet.</p> : null}
      </div>
      <form
        ref={formRef}
        className="grid gap-2 border-t border-border p-4"
        onSubmit={handleSubmit}
      >
        {pendingQuote ? (
          <div className="rounded bg-surface p-2">
            <div className="text-xs font-medium text-accent">Commenting on p.{pendingQuote.pageNumber}</div>
            <blockquote className="mt-1 border-l-2 border-accent/30 pl-2 text-xs italic text-muted line-clamp-3">
              &ldquo;{pendingQuote.text}&rdquo;
            </blockquote>
            <input type="hidden" name="pageNumber" value={pendingQuote.pageNumber} />
            <input type="hidden" name="quotedText" value={pendingQuote.text} />
          </div>
        ) : null}
        <textarea
          ref={textareaRef}
          className="min-h-20 rounded border border-border px-3 py-2 text-sm"
          name="body"
          placeholder={pendingQuote ? "Add your comment on this selection..." : "Add a comment"}
          required
        />
        <button className="rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">Comment</button>
      </form>
    </section>
  );
}
