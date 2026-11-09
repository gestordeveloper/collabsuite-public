-- AlterTable
ALTER TABLE `recording` ADD COLUMN `share_token` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `recording_share_token_key` ON `recording`(`share_token`);
