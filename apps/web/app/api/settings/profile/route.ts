import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";

const MAX_NAME_LENGTH = 80;

/** Update the current user's own profile (display name). */
export async function POST(request: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
  if (!body || typeof body.name !== "string") {
    return Response.json({ error: "name required" }, { status: 400 });
  }

  const name = body.name.trim().slice(0, MAX_NAME_LENGTH);
  await prisma.user.update({
    where: { id: user.id },
    // An emptied field reverts to showing the email everywhere.
    data: { name: name.length > 0 ? name : null }
  });

  return Response.json({ ok: true, name: name.length > 0 ? name : null });
}
