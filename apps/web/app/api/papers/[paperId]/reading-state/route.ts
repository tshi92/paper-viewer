import { isReadingState } from "@paper-viewer/core/paper-status";
import { prisma } from "@paper-viewer/db";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";

export async function POST(request: Request, { params }: { params: Promise<{ paperId: string }> }) {
  const user = await requireCurrentUser();
  const { paperId } = await params;

  // JSON is the interactive path (inline chips, no page reload); the form
  // fallback stays for plain <form> posts and finishes with a redirect.
  const isJson = (request.headers.get("content-type") ?? "").includes("application/json");
  let state = "";
  if (isJson) {
    const body = (await request.json().catch(() => null)) as { state?: unknown } | null;
    state = typeof body?.state === "string" ? body.state : "";
  } else {
    const formData = await request.formData();
    state = formData.get("state")?.toString() ?? "";
  }

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

  if (isJson) {
    return Response.json({ state });
  }
  redirect(`/papers/${paperId}`);
}
