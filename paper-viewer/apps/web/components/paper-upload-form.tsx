export function PaperUploadForm() {
  return (
    <form className="grid gap-3 rounded border border-border bg-white p-4" action="/api/papers" method="post" encType="multipart/form-data">
      <h2 className="text-base font-semibold">Upload paper</h2>
      <input className="rounded border border-border px-3 py-2" name="title" placeholder="Paper title" required />
      <textarea className="min-h-24 rounded border border-border px-3 py-2" name="abstract" placeholder="Abstract" />
      <input className="rounded border border-border px-3 py-2" name="authors" placeholder="Authors, comma separated" required />
      <input className="rounded border border-border px-3 py-2" name="pdf" type="file" accept="application/pdf" required />
      <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">Upload</button>
    </form>
  );
}
