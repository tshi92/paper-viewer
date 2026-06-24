-- CreateTable
CREATE TABLE "PaperKeynote" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperKeynote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaperKeynote_workspaceId_paperId_idx" ON "PaperKeynote"("workspaceId", "paperId");

-- CreateIndex
CREATE INDEX "PaperKeynote_authorId_idx" ON "PaperKeynote"("authorId");

-- AddForeignKey
ALTER TABLE "PaperKeynote" ADD CONSTRAINT "PaperKeynote_workspaceId_paperId_fkey" FOREIGN KEY ("workspaceId", "paperId") REFERENCES "WorkspacePaper"("workspaceId", "paperId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperKeynote" ADD CONSTRAINT "PaperKeynote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
