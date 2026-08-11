import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { prisma } from "@paper-viewer/db";
import { Resend } from "resend";
import { createHash, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";
import { getEnv } from "@/lib/env";

const invitationSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"])
});

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  const env = getEnv();

  if (!canManageWorkspaceSettings(user.role)) {
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

  const inviteUrl = `${env.APP_URL}/invite/${token}`;

  // Send invitation email if Resend is configured
  if (env.RESEND_API_KEY) {
    const resend = new Resend(env.RESEND_API_KEY);
    await resend.emails.send({
      from: "Paper Viewer <onboarding@resend.dev>",
      to: input.email.toLowerCase(),
      subject: `You're invited to join Paper Viewer`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2>You're invited to Paper Viewer</h2>
          <p><strong>${user.name ?? user.email}</strong> invited you to join their research workspace as <strong>${input.role}</strong>.</p>
          <p>Click the link below to create your account and join:</p>
          <p><a href="${inviteUrl}" style="display: inline-block; background: #256f8f; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">Join workspace</a></p>
          <p style="color: #657386; font-size: 14px;">This invitation expires in 7 days.</p>
          <p style="color: #657386; font-size: 12px;">If the button doesn't work, copy this link:<br/>${inviteUrl}</p>
        </div>
      `
    });
  }

  redirect(`/settings/members?invitation=${encodeURIComponent(token)}`);
}
