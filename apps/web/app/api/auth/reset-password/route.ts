import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { BCRYPT_COST, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { consumePasswordReset, resolvePasswordReset } from "@/lib/password-reset";

const resetSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(MIN_PASSWORD_LENGTH)
});

/**
 * Redeems a reset link and sets the new password.
 *
 * The link is claimed before the password is written, so a double submit (or
 * two tabs) cannot spend the same link twice. The user is not signed in
 * afterwards on purpose: proving the new password works at the login screen is
 * the point of having reset it.
 */
export async function POST(request: Request) {
  const formData = await request.formData();
  const token = String(formData.get("token") ?? "");
  const parsed = resetSchema.safeParse({ token, password: formData.get("password") });

  if (!parsed.success) {
    redirect(`/reset-password/${encodeURIComponent(token)}?error=weak`);
  }

  const reset = await resolvePasswordReset(parsed.data.token);
  if (!reset || !(await consumePasswordReset(reset.id))) {
    redirect(`/reset-password/${encodeURIComponent(token)}?error=invalid`);
  }

  await prisma.user.update({
    where: { id: reset.userId },
    data: { passwordHash: await bcrypt.hash(parsed.data.password, BCRYPT_COST) }
  });

  redirect("/login?reset=done");
}
