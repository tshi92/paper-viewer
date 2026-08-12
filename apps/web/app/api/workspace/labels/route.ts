import { prisma } from "@paper-viewer/db";
import { z } from "zod";
import { labelScopes } from "@paper-viewer/core/labels";
import { requireCurrentUser, type CurrentUser } from "@/lib/auth";
import type { LabelListItem, LabelView } from "@/lib/annotation-types";

const createLabelSchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .transform((color) => color.toLowerCase()),
  scope: z.enum(labelScopes)
});

function toLabelView(label: { id: string; name: string; color: string; scope: LabelView["scope"] }): LabelView {
  return { id: label.id, name: label.name, color: label.color, scope: label.scope };
}

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
    orderBy: [{ scope: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { annotationLinks: true, paperLinks: true } } }
  });

  return Response.json({
    labels: labels.map(
      (label): LabelListItem => ({
        ...toLabelView(label),
        usageCount: label._count.annotationLinks + label._count.paperLinks
      })
    )
  });
}

export async function POST(request: Request) {
  const user = await resolveCurrentUser();
  if (!user) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  // Any workspace member may curate labels; they are shared vocabulary, not settings.
  const input = createLabelSchema.parse(await request.json());

  try {
    const label = await prisma.label.create({
      data: { workspaceId: user.workspaceId, ...input }
    });
    return Response.json({ label: toLabelView(label) }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return Response.json({ error: `A ${input.scope} label named "${input.name}" already exists` }, { status: 409 });
    }
    throw error;
  }
}
