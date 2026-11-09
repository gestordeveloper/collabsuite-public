-- AlterTable
ALTER TABLE `github_account` ADD COLUMN `refresh_token` TEXT NULL,
    ADD COLUMN `expires_at` DATETIME(3) NULL,
    ADD COLUMN `refresh_expires_at` DATETIME(3) NULL;
