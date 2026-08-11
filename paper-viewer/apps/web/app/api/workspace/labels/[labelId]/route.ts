import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { canManageLabels } from "@paper-viewer/core/permissions";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";

const updateLabelSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
});

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

async function resolveCurrentUser(): Promise<CurrentUser | null> {
  try {
    return await requireCurrentUser();
  } catch {
    return null;
  }
}

async function findOwnedLabel(labelId: string, workspaceId: string) {
  const label = await prisma.label.findUnique({ where: { id: labelId } });
  return label && label.workspaceId === workspaceId ? label : null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ labelId: string }> }) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!canManageLabels(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { labelId } = await params;
  const existing = await findOwnedLabel(labelId, user.workspaceId);
  if (!existing) {
    return Response.json({ error: "Label not found" }, { status: 404 });
  }

  const input = updateLabelSchema.parse(await request.json());
  const data = {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.color === undefined ? {} : { color: input.color })
  };

  try {
    const label = await prisma.label.update({ where: { id: labelId }, data });
    return Response.json({ label });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return Response.json(
        { error: `A ${existing.scope} label named "${input.name ?? existing.name}" already exists` },
        { status: 409 }
      );
    }
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ labelId: string }> }) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!canManageLabels(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { labelId } = await params;
  if (!(await findOwnedLabel(labelId, user.workspaceId))) {
    return Response.json({ error: "Label not found" }, { status: 404 });
  }

  await prisma.label.delete({ where: { id: labelId } });

  return Response.json({ ok: true });
}
