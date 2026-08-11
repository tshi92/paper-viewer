import { DEFAULT_ANNOTATION_LABELS, PAPER_LABEL_PALETTE } from "@paper-viewer/core/labels";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seedAnnotationLabels(workspaceId: string) {
  await prisma.label.createMany({
    data: DEFAULT_ANNOTATION_LABELS.map((label) => ({
      workspaceId,
      name: label.name,
      color: label.color,
      scope: "annotation" as const
    })),
    skipDuplicates: true
  });
}

async function backfillPaperLabels(workspaceId: string) {
  const papers = await prisma.workspacePaper.findMany({
    where: { workspaceId },
    select: { paperId: true, tags: true }
  });

  const uniqueTags = [...new Set(papers.flatMap((paper) => paper.tags))];

  for (const [index, tag] of uniqueTags.entries()) {
    const label = await prisma.label.upsert({
      where: { workspaceId_scope_name: { workspaceId, scope: "paper", name: tag } },
      update: {},
      create: {
        workspaceId,
        name: tag,
        scope: "paper",
        color: PAPER_LABEL_PALETTE[index % PAPER_LABEL_PALETTE.length]!
      }
    });

    for (const paper of papers.filter((candidate) => candidate.tags.includes(tag))) {
      await prisma.workspacePaperLabel.upsert({
        where: {
          workspaceId_paperId_labelId: { workspaceId, paperId: paper.paperId, labelId: label.id }
        },
        update: {},
        create: { workspaceId, paperId: paper.paperId, labelId: label.id }
      });
    }
  }

  return uniqueTags.length;
}

async function main() {
  const workspaces = await prisma.workspace.findMany({ select: { id: true } });

  for (const workspace of workspaces) {
    await seedAnnotationLabels(workspace.id);
    const paperLabelCount = await backfillPaperLabels(workspace.id);
    console.log(`workspace ${workspace.id}: ${paperLabelCount} paper labels backfilled`);
  }
}

main()
  .finally(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
