import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";
import { z } from "zod";

const updateSchema = z.object({
  content: z.string().min(1).max(10000)
});

export async function PUT(request: Request, { params }: { params: Promise<{ paperId: string; keynoteId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId, keynoteId } = await params;

  const keynote = await prisma.paperKeynote.findFirst({
    where: { id: keynoteId, workspaceId: user.workspaceId, paperId, authorId: user.id }
  });
  if (!keynote) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const { content } = updateSchema.parse(body);

  const updated = await prisma.paperKeynote.update({
    where: { id: keynoteId },
    data: { content },
    include: { author: { select: { email: true, name: true } } }
  });

  return Response.json({ keynote: updated });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ paperId: string; keynoteId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId, keynoteId } = await params;

  const keynote = await prisma.paperKeynote.findFirst({
    where: { id: keynoteId, workspaceId: user.workspaceId, paperId, authorId: user.id }
  });
  if (!keynote) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.paperKeynote.delete({ where: { id: keynoteId } });
  return Response.json({ ok: true });
}
