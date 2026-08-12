import { prisma } from "@paper-viewer/db";
import { requireCurrentUser } from "@/lib/auth";

/**
 * Serves an area annotation's screenshot as a real image. Keeping the base64
 * payload out of the annotation list means the browser fetches each thumbnail
 * once and caches it — an annotation's image never changes after creation, so
 * the response is immutable.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ paperId: string; annotationId: string }> }
) {
  let user;
  try {
    user = await requireCurrentUser();
  } catch {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  const { paperId, annotationId } = await params;
  const annotation = await prisma.annotation.findFirst({
    where: { id: annotationId, paperId, workspaceId: user.workspaceId },
    select: { areaImage: true }
  });

  const match = annotation?.areaImage
    ? /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(annotation.areaImage)
    : null;
  if (!match) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(Buffer.from(match[2]!, "base64"), {
    headers: {
      "Content-Type": match[1]!,
      "Cache-Control": "private, max-age=31536000, immutable"
    }
  });
}
