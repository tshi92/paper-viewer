import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { BCRYPT_COST, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

const changeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1)
});

/**
 * Changes the signed-in user's own password.
 *
 * The current password is required even though the caller is already
 * authenticated: a session left open on a shared machine must not be enough to
 * take the account over.
 *
 * Every other session survives this. The cookie is an HMAC over the user id
 * and nothing else, so it holds no value a password change could invalidate —
 * including on whatever device the password is being changed because of.
 * Closing that needs a counter in the token checked against the user row, and
 * it would have to cover the reset flow too, so it is not smuggled in here.
 */
export async function POST(request: Request) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parsed = changeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const { currentPassword, newPassword } = parsed.data;

  // Identity before intent: whoever is at the keyboard proves they are the
  // account holder before anything they asked for is even considered.
  const record = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true }
  });

  if (!record || !(await bcrypt.compare(currentPassword, record.passwordHash))) {
    return Response.json({ error: "incorrect" }, { status: 400 });
  }

  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return Response.json({ error: "weak" }, { status: 400 });
  }

  if (newPassword === currentPassword) {
    return Response.json({ error: "same" }, { status: 400 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST) }
  });

  return Response.json({ ok: true });
}
