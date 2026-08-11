/*
  Warnings:

  - You are about to drop the `PaperKeynote` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "PaperKeynote" DROP CONSTRAINT "PaperKeynote_authorId_fkey";

-- DropForeignKey
ALTER TABLE "PaperKeynote" DROP CONSTRAINT "PaperKeynote_workspaceId_paperId_fkey";

-- DropTable
DROP TABLE "PaperKeynote";
