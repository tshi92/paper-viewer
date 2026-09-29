-- CreateTable
CREATE TABLE "Researcher" (
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "affiliation" TEXT NOT NULL,
    "knownFor" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Researcher_pkey" PRIMARY KEY ("slug")
);

-- CreateTable
CREATE TABLE "ResearcherPaper" (
    "researcherSlug" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ResearcherPaper_pkey" PRIMARY KEY ("researcherSlug","paperId")
);

-- CreateTable
CREATE TABLE "PaperDirection" (
    "workspaceId" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,

    CONSTRAINT "PaperDirection_pkey" PRIMARY KEY ("workspaceId","paperId")
);

-- CreateTable
CREATE TABLE "ResearcherDigest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResearcherDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResearcherPaper_paperId_idx" ON "ResearcherPaper"("paperId");

-- CreateIndex
CREATE INDEX "PaperDirection_paperId_idx" ON "PaperDirection"("paperId");

-- CreateIndex
CREATE UNIQUE INDEX "ResearcherDigest_workspaceId_month_key" ON "ResearcherDigest"("workspaceId", "month");

-- AddForeignKey
ALTER TABLE "ResearcherPaper" ADD CONSTRAINT "ResearcherPaper_researcherSlug_fkey" FOREIGN KEY ("researcherSlug") REFERENCES "Researcher"("slug") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearcherPaper" ADD CONSTRAINT "ResearcherPaper_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDirection" ADD CONSTRAINT "PaperDirection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperDirection" ADD CONSTRAINT "PaperDirection_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResearcherDigest" ADD CONSTRAINT "ResearcherDigest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
