import { DEFAULT_ANNOTATION_LABELS } from "@paper-viewer/core/labels";
import { prisma } from "@paper-viewer/db";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { z } from "zod";
import { setSession } from "@/lib/session";

const bootstrapSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(12)
});

export async function POST(request: Request) {
  const existingOwner = await prisma.workspaceMembership.findFirst({
    where: { role: "owner" }
  });

  if (existingOwner) {
    redirect("/login");
  }

  const formData = await request.formData();
  const parsed = bootstrapSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password")
  });

  if (!parsed.success) {
    redirect("/bootstrap?error=1");
  }
  const input = parsed.data;

  const passwordHash = await bcrypt.hash(input.password, 12);

  // Most likely failure is a duplicate email; the form gets a generic retry
  // message instead of a raw 500.
  const user = await prisma.user
    .create({
      data: {
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash,
        memberships: {
          create: {
            role: "owner",
            workspace: {
              create: {
                name: "Research Team"
              }
            }
          }
        }
      }
    })
    .catch(() => null);

  if (!user) {
    redirect("/bootstrap?error=1");
  }

  const membership = await prisma.workspaceMembership.findFirst({
    where: { userId: user.id },
    select: { workspaceId: true }
  });

  if (membership) {
    await prisma.label.createMany({
      data: DEFAULT_ANNOTATION_LABELS.map((label) => ({
        workspaceId: membership.workspaceId,
        name: label.name,
        color: label.color,
        scope: "annotation" as const
      })),
      skipDuplicates: true
    });
  }

  await setSession(user.id);
  redirect("/library");
}
