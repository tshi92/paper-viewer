-- AlterTable
ALTER TABLE "DailyDigest" ADD COLUMN     "feishuSentAt" TIMESTAMP(3),
ADD COLUMN     "pendingPaperIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "ResearchPreferences" ADD COLUMN     "feishuWebhookUrl" TEXT;
