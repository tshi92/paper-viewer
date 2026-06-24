export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form className="mt-6 grid gap-4" method="post" action="/api/auth/login">
        <input className="rounded border border-border px-3 py-2" name="email" placeholder="Email" type="email" required />
        <input className="rounded border border-border px-3 py-2" name="password" placeholder="Password" type="password" required />
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">Sign in</button>
      </form>
    </main>
  );
}
