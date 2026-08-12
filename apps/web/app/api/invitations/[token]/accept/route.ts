import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { setSession } from "@/lib/session";

const acceptInvitationSchema = z.object({
  name: z.string().min(1),
  password: z.string().min(12)
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const formData = await request.formData();
  const input = acceptInvitationSchema.parse({
    name: formData.get("name"),
    password: formData.get("password")
  });

  const invitation = await prisma.invitation.findUnique({
    where: { tokenHash: hashToken(token) }
  });

  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    return new Response("Invitation is invalid or expired", { status: 400 });
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: {
      email: invitation.email,
      name: input.name,
      passwordHash,
      memberships: {
        create: {
          workspaceId: invitation.workspaceId,
          role: invitation.role
        }
      }
    }
  });

  await prisma.invitation.update({
    where: { id: invitation.id },
    data: { acceptedAt: new Date() }
  });

  await setSession(user.id);
  redirect("/");
}
