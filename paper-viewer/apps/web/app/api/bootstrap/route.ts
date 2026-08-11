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
  const input = bootstrapSchema.parse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password")
  });

  const passwordHash = await bcrypt.hash(input.password, 12);

  const user = await prisma.user.create({
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
  });

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
