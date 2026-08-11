import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { canManageLabels } from "@paper-viewer/core/permissions";
import { labelScopes } from "@paper-viewer/core/labels";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";

const createLabelSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  scope: z.enum(labelScopes)
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

export async function GET() {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const labels = await prisma.label.findMany({
    where: { workspaceId: user.workspaceId },
    orderBy: [{ scope: "asc" }, { createdAt: "asc" }]
  });

  return Response.json({ labels });
}

export async function POST(request: Request) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  if (!canManageLabels(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const input = createLabelSchema.parse(await request.json());

  try {
    const label = await prisma.label.create({
      data: { workspaceId: user.workspaceId, ...input }
    });
    return Response.json({ label }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return Response.json({ error: `A ${input.scope} label named "${input.name}" already exists` }, { status: 409 });
    }
    throw error;
  }
}
