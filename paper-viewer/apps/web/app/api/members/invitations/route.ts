import { prisma } from "@paper-viewer/db";
import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";

const invitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"])
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  if (user.role !== "owner") {
    return new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const input = invitationSchema.parse({
    email: formData.get("email"),
    role: formData.get("role")
  });

  const token = randomBytes(32).toString("base64url");
  await prisma.invitation.create({
    data: {
      workspaceId: user.workspaceId,
      email: input.email.toLowerCase(),
      role: input.role,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });

  redirect(`/settings/members?invitation=${encodeURIComponent(token)}`);
}
