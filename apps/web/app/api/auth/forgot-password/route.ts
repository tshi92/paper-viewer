import { prisma } from "@paper-viewer/db";
import { Resend } from "resend";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { createPasswordReset } from "@/lib/password-reset";

const requestSchema = z.object({ email: z.string().email() });

/**
 * Requests a password reset link.
 *
 * The response never varies with whether the address has an account: a form
 * that says "no such user" is an account enumeration oracle, and this one is
 * reachable without logging in. Both paths land on the same "check your inbox"
 * page.
 */
export async function POST(request: Request) {
  const env = getEnv();
  const formData = await request.formData();
  const parsed = requestSchema.safeParse({ email: formData.get("email") });

  // A self-hosted deployment with no mail provider cannot deliver the link, and
  // showing it on screen instead would let anyone reset anyone's password. Say
  // so plainly rather than pretending an email is on its way.
  if (!env.RESEND_API_KEY) {
    redirect("/forgot-password?state=unavailable");
  }

  if (parsed.success) {
    const user = await prisma.user.findUnique({
      where: { email: parsed.data.email.toLowerCase() },
      select: { id: true, email: true }
    });

    if (user) {
      const token = await createPasswordReset(user.id);
      const resetUrl = `${env.APP_URL}/reset-password/${token}`;
      const resend = new Resend(env.RESEND_API_KEY);
      // A provider that rejects the send must not turn into a 500 that tells
      // the caller this address exists; it is logged and the page still says
      // the same thing either way.
      await resend.emails
        .send({
          from: "Paper Viewer <onboarding@resend.dev>",
          to: user.email,
          subject: "Reset your Paper Viewer password",
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
              <h2>Reset your password</h2>
              <p>Someone asked to reset the password for this address. Click below to choose a new one:</p>
              <p><a href="${resetUrl}" style="display: inline-block; background: #256f8f; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 500;">Choose a new password</a></p>
              <p style="color: #657386; font-size: 14px;">This link works once and expires in an hour.</p>
              <p style="color: #657386; font-size: 14px;">If you did not ask for this, you can ignore this email — your password stays as it is.</p>
              <p style="color: #657386; font-size: 12px;">If the button doesn't work, copy this link:<br/>${resetUrl}</p>
            </div>
          `
        })
        .catch((error) => {
          console.error("[auth] password reset email failed", error);
        });
    }
  }

  redirect("/forgot-password?state=sent");
}
