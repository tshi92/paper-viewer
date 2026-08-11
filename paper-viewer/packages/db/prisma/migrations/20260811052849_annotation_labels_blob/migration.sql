-- CreateEnum
CREATE TYPE "LabelScope" AS ENUM ('annotation', 'paper');

-- CreateEnum
CREATE TYPE "AnnotationType" AS ENUM ('highlight', 'area');

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "annotationId" TEXT;

-- AlterTable
ALTER TABLE "Paper" ADD COLUMN     "blobUrl" TEXT;

-- CreateTable
CREATE TABLE "Label" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "scope" "LabelScope" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Label_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Annotation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "AnnotationType" NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "position" JSONB NOT NULL,
    "quotedText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Annotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnotationLabel" (
    "annotationId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AnnotationLabel_pkey" PRIMARY KEY ("annotationId","labelId")
);

-- CreateTable
CREATE TABLE "WorkspacePaperLabel" (
    "workspaceId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,

    CONSTRAINT "WorkspacePaperLabel_pkey" PRIMARY KEY ("workspaceId","paperId","labelId")
);

-- CreateIndex
CREATE INDEX "Label_workspaceId_idx" ON "Label"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Label_workspaceId_scope_name_key" ON "Label"("workspaceId", "scope", "name");

-- CreateIndex
CREATE INDEX "Annotation_workspaceId_paperId_idx" ON "Annotation"("workspaceId", "paperId");

-- CreateIndex
CREATE INDEX "Comment_annotationId_idx" ON "Comment"("annotationId");

-- AddForeignKey
ALTER TABLE "Label" ADD CONSTRAINT "Label_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_workspaceId_paperId_fkey" FOREIGN KEY ("workspaceId", "paperId") REFERENCES "WorkspacePaper"("workspaceId", "paperId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Annotation" ADD CONSTRAINT "Annotation_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnotationLabel" ADD CONSTRAINT "AnnotationLabel_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "Annotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnotationLabel" ADD CONSTRAINT "AnnotationLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspacePaperLabel" ADD CONSTRAINT "WorkspacePaperLabel_workspaceId_paperId_fkey" FOREIGN KEY ("workspaceId", "paperId") REFERENCES "WorkspacePaper"("workspaceId", "paperId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspacePaperLabel" ADD CONSTRAINT "WorkspacePaperLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "Label"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_annotationId_fkey" FOREIGN KEY ("annotationId") REFERENCES "Annotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
