-- AlterTable
ALTER TABLE "Server" ADD COLUMN "backupRetentionCount" INTEGER;

-- AlterTable
ALTER TABLE "Backup" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;
