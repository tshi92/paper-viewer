import { canManageWorkspaceSettings } from "@paper-viewer/core/permissions";
import { prisma } from "@paper-viewer/db";
import { redirect } from "next/navigation";
import { requireCurrentUser } from "@/lib/auth";

export async function POST(request: Request) {
  const user = await requireCurrentUser();

  if (!canManageWorkspaceSettings(user.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const formData = await request.formData();

  const topics = (formData.get("topics")?.toString() ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const keywords = (formData.get("keywords")?.toString() ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const arxivCategories = (formData.get("arxivCategories")?.toString() ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const excludedTopics = (formData.get("excludedTopics")?.toString() ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const papersPerDay = Math.max(1, Math.min(20, Number(formData.get("papersPerDay")) || 10));

  await prisma.researchPreferences.upsert({
    where: { workspaceId: user.workspaceId },
    update: { topics, keywords, arxivCategories, excludedTopics, papersPerDay },
    create: {
      workspaceId: user.workspaceId,
      topics,
      keywords,
      arxivCategories,
      excludedTopics,
      papersPerDay
    }
  });

  redirect("/settings/preferences");
}
