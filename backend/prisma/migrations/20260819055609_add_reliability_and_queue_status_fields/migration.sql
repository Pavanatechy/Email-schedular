-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('PENDING', 'QUEUED');

-- AlterTable
ALTER TABLE "Email" ADD COLUMN     "processingStartedAt" TIMESTAMP(3),
ADD COLUMN     "processingToken" TEXT,
ADD COLUMN     "queueStatus" "QueueStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Email_queueStatus_idx" ON "Email"("queueStatus");

-- CreateIndex
CREATE INDEX "Email_processingStartedAt_idx" ON "Email"("processingStartedAt");

-- CreateIndex
CREATE INDEX "Email_senderId_idx" ON "Email"("senderId");
