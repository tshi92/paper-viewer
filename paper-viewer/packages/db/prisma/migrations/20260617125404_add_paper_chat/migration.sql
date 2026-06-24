-- CreateTable
CREATE TABLE "PaperChatMessage" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperFileExtract" (
    "id" TEXT NOT NULL,
    "paperId" TEXT NOT NULL,
    "llmFileId" TEXT NOT NULL,
    "textContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperFileExtract_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaperChatMessage_paperId_userId_idx" ON "PaperChatMessage"("paperId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PaperFileExtract_paperId_key" ON "PaperFileExtract"("paperId");

-- CreateIndex
CREATE INDEX "PaperFileExtract_paperId_idx" ON "PaperFileExtract"("paperId");
