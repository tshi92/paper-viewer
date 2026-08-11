import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";
import { z } from "zod";

const keynoteSchema = z.object({
  content: z.string().min(1).max(10000),
  source: z.enum(["manual", "chat", "comment"]).default("manual")
});

export async function GET(_request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  const keynotes = await prisma.paperKeynote.findMany({
    where: { workspaceId: user.workspaceId, paperId },
    include: { author: { select: { email: true, name: true } } },
    orderBy: { createdAt: "asc" }
  });

  return Response.json({ keynotes });
}

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  const wp = await prisma.workspacePaper.findUnique({
    where: { workspaceId_paperId: { workspaceId: user.workspaceId, paperId } }
  });
  if (!wp) {
    return Response.json({ error: "Paper not found" }, { status: 404 });
  }

  const body = await request.json();
  const { content, source } = keynoteSchema.parse(body);

  const keynote = await prisma.paperKeynote.create({
    data: {
      workspaceId: user.workspaceId,
      paperId,
      authorId: user.id,
      content,
      source
    },
    include: { author: { select: { email: true, name: true } } }
  });

  return Response.json({ keynote });
}
