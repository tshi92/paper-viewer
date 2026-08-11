-- CreateTable
CREATE TABLE "ResearchPreferences" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludedTopics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "papersPerDay" INTEGER NOT NULL DEFAULT 10,
    "arxivCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResearchPreferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ResearchPreferences_workspaceId_key" ON "ResearchPreferences"("workspaceId");
