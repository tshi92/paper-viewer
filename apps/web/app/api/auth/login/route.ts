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
  const input = loginSchema.parse({
    email: formData.get("email"),
    password: formData.get("password")
  });

  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() }
  });

  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    redirect("/login");
  }

  await setSession(user.id);
  redirect("/library");
}
