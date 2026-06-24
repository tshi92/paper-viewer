-- CreateTable
CREATE TABLE "PaperAnalysis" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "summary" TEXT NOT NULL,
    "problem" TEXT,
    "method" TEXT,
    "keyFindings" TEXT,
    "whyItMatters" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyDigest" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "overviewSummary" TEXT NOT NULL,
    "paperIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyDigest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaperAnalysis_paperId_idx" ON "PaperAnalysis"("paperId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyDigest_workspaceId_date_key" ON "DailyDigest"("workspaceId", "date");

-- AddForeignKey
ALTER TABLE "PaperAnalysis" ADD CONSTRAINT "PaperAnalysis_paperId_fkey" FOREIGN KEY ("paperId") REFERENCES "Paper"("id") ON DELETE CASCADE ON UPDATE CASCADE;
