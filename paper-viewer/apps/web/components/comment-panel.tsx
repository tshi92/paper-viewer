type CommentView = {
  id: string;
  body: string;
  createdAt: Date;
  author: {
    email: string;
    name: string | null;
  };
};

export function CommentPanel({ paperId, comments }: { paperId: string; comments: CommentView[] }) {
  return (
    <section className="rounded border border-border bg-white">
      <div className="border-b border-border px-4 py-3">
        <h2 className="font-semibold">Discussion</h2>
      </div>
      <div className="max-h-80 divide-y divide-border overflow-auto">
        {comments.map((comment) => (
          <article className="px-4 py-3" key={comment.id}>
            <div className="text-xs text-muted">{comment.author.name ?? comment.author.email}</div>
            <p className="mt-1 text-sm">{comment.body}</p>
          </article>
        ))}
        {comments.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No comments yet.</p> : null}
      </div>
      <form className="grid gap-2 border-t border-border p-4" action={`/api/papers/${paperId}/comments`} method="post">
        <textarea className="min-h-24 rounded border border-border px-3 py-2" name="body" placeholder="Add a comment" required />
        <button className="rounded bg-accent px-3 py-2 text-sm font-medium text-white" type="submit">Comment</button>
      </form>
    </section>
  );
}
