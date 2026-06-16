import { prisma } from "@paper-viewer/db";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";
import { CopyLinkButton } from "@/components/copy-link-button";

export default async function MembersPage({
  searchParams
}: {
  searchParams: Promise<{ invitation?: string }>;
}) {
  const user = await requireCurrentUser();
  const { invitation } = await searchParams;

  if (user.role !== "owner") {
    redirect("/library");
  }

  // Build full URL from request headers
  const headersList = await headers();
  const host = headersList.get("host") ?? "localhost:3000";
  const proto = headersList.get("x-forwarded-proto") ?? "http";
  const baseUrl = `${proto}://${host}`;
  const inviteUrl = invitation ? `${baseUrl}/invite/${invitation}` : null;

  const [memberships, invitations] = await Promise.all([
    prisma.workspaceMembership.findMany({
      where: { workspaceId: user.workspaceId },
      include: { user: true },
      orderBy: { createdAt: "asc" }
    }),
    prisma.invitation.findMany({
      where: {
        workspaceId: user.workspaceId,
        acceptedAt: null
      },
      orderBy: { createdAt: "desc" }
    })
  ]);

  return (
    <div className="grid grid-cols-[360px_1fr] gap-6">
      <form className="grid gap-3 rounded border border-border bg-white p-4" action="/api/members/invitations" method="post">
        <h1 className="text-lg font-semibold">Invite member</h1>
        <input className="rounded border border-border px-3 py-2" name="email" placeholder="Email" type="email" required />
        <select className="rounded border border-border px-3 py-2" name="role" defaultValue="member">
          <option value="member">member</option>
          <option value="admin">admin</option>
        </select>
        <button className="rounded bg-accent px-3 py-2 font-medium text-white" type="submit">Create invitation</button>
        {inviteUrl ? (
          <div className="rounded bg-surface p-3">
            <div className="text-xs font-medium text-accent">Invitation created!</div>
            <p className="mt-1 break-all text-xs text-muted">{inviteUrl}</p>
            <CopyLinkButton url={inviteUrl} />
          </div>
        ) : null}
      </form>

      <section className="grid gap-4">
        <div className="rounded border border-border bg-white">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold">Members</h2>
          </div>
          <div className="divide-y divide-border">
            {memberships.map((membership) => (
              <div className="flex items-center justify-between px-4 py-3" key={membership.id}>
                <span>{membership.user.email}</span>
                <span className="text-sm text-muted">{membership.role}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-border bg-white">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-semibold">Open invitations</h2>
          </div>
          <div className="divide-y divide-border">
            {invitations.map((invitation) => (
              <div className="px-4 py-3" key={invitation.id}>
                <div className="font-medium">{invitation.email}</div>
                <div className="text-sm text-muted">{invitation.role}</div>
              </div>
            ))}
            {invitations.length === 0 ? <p className="px-4 py-6 text-sm text-muted">No open invitations.</p> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
