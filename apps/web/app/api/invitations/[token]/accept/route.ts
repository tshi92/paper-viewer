import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { isUniqueViolation } from "@/lib/daily-digest";
import { BCRYPT_COST, MIN_PASSWORD_LENGTH } from "@/lib/password-policy";
import { setSession } from "@/lib/session";

const acceptInvitationSchema = z.object({
  name: z.string().min(1),
  password: z.string(),
  confirmPassword: z.string()
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Accepts an invitation: creates the account it was addressed to and signs it
 * in.
 *
 * Every refusal goes back to the form with a reason rather than ending at a
 * bare status code, because this is the one page a person meets before they
 * have an account — a plain-text 400 gives them nothing to do next. The one
 * exception is a link that is spent or expired, which redirects with no reason
 * at all: the page resolves the invitation itself and says so in its own words.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = `/invite/${encodeURIComponent(token)}`;
  const formData = await request.formData();

  const parsed = acceptInvitationSchema.safeParse({
    name: formData.get("name"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword")
  });
  if (!parsed.success) {
    redirect(`${back}?error=invalid`);
  }

  const { name, password, confirmPassword } = parsed.data;
  if (password.length < MIN_PASSWORD_LENGTH) {
    redirect(`${back}?error=weak`);
  }
  if (password !== confirmPassword) {
    redirect(`${back}?error=mismatch`);
  }

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) }
  });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    redirect(back);
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email: invitation.email,
        name,
        passwordHash,
        memberships: {
          create: {
            workspaceId: invitation.workspaceId,
            role: invitation.role
          }
        }
      }
    });
  } catch (error) {
    // The address already has an account — an invitation sent to someone who
    // signed up in the meantime. Nothing to create, and telling them to sign
    // in beats a 500.
    if (isUniqueViolation(error)) {
      redirect(`${back}?error=taken`);
    }
    throw error;
  }

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date() }
  });

  await setSession(user.id);
  redirect("/");
}
