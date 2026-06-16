import { prisma } from "@paper-viewer/db";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCurrentUser } from "@/lib/auth";

const commentSchema = z.object({
  body: z.string().min(1).max(5000)
});

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  const workspacePaper = await prisma.workspacePaper.findUnique({
    where: {
      workspaceId_paperId: {
        workspaceId: user.workspaceId,
        paperId
      }
    }
  });

  if (!workspacePaper) {
    return new Response("Paper not found", { status: 404 });
  }

  const formData = await request.formData();
  const input = commentSchema.parse({
    body: formData.get("body")
  });

  await prisma.comment.create({
    data: {
      workspaceId: user.workspaceId,
      paperId,
      authorId: user.id,
      body: input.body
    }
  });

  redirect(`/papers/${paperId}`);
}
