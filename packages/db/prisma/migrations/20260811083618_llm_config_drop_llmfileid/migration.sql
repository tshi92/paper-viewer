/*
  Warnings:

  - You are about to drop the column `llmFileId` on the `PaperFileExtract` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "PaperFileExtract" DROP COLUMN "llmFileId";

-- CreateTable
CREATE TABLE "LlmConfig" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LlmConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LlmConfig_workspaceId_key" ON "LlmConfig"("workspaceId");
