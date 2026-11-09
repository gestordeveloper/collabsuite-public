-- AlterTable
ALTER TABLE `comic_episode` ADD COLUMN `share_token` VARCHAR(64) NULL,
    ADD COLUMN `approved_at` DATETIME(3) NULL,
    ADD COLUMN `approved_by` VARCHAR(150) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `comic_episode_share_token_key` ON `comic_episode`(`share_token`);
