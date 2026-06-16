export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Accept invitation</h1>
      <form className="mt-6 grid gap-4" method="post" action={`/api/invitations/${token}/accept`}>
        <input className="rounded border border-border px-3 py-2" name="name" placeholder="Name" required />
        <input className="rounded border border-border px-3 py-2" name="password" placeholder="Password" type="password" required minLength={12} />
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">Join workspace</button>
      </form>
    </main>
  );
}
