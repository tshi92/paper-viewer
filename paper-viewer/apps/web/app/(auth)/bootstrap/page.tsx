export default function BootstrapPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Create owner account</h1>
      <form className="mt-6 grid gap-4" method="post" action="/api/bootstrap">
        <input className="rounded border border-border px-3 py-2" name="name" placeholder="Name" required />
        <input className="rounded border border-border px-3 py-2" name="email" placeholder="Email" type="email" required />
        <input className="rounded border border-border px-3 py-2" name="password" placeholder="Password" type="password" required minLength={12} />
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">Create workspace</button>
      </form>
    </main>
  );
}
