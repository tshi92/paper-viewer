import { isReadingState } from "@paper-viewer/core/paper-status";
import { prisma } from "@paper-viewer/db";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;
  const formData = await request.formData();
  const state = formData.get("state")?.toString() ?? "";

  if (!isReadingState(state)) {
    return new Response("Invalid reading state", { status: 400 });
  }

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

  await prisma.readingStateRecord.upsert({
    where: {
      workspaceId_paperId_userId: {
        workspaceId: user.workspaceId,
        paperId,
        userId: user.id
      }
    },
    update: { state },
    create: {
      workspaceId: user.workspaceId,
      paperId,
      userId: user.id,
      state
    }
  });

  redirect(`/papers/${paperId}`);
}
