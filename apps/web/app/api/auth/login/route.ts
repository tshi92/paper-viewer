import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { setSession } from "@/lib/session";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export async function POST(request: Request) {
  const formData = await request.formData();
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });

  // One shared error path for malformed input and wrong credentials: the login
  // page must never distinguish "no such user" from "wrong password" (account
  // enumeration), so a bad email shape gets the same message too.
  if (!parsed.success) {
    redirect("/login?error=invalid");
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() }
  });

  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    redirect("/login?error=invalid");
  }

  await setSession(user.id);
  redirect("/library");
}
