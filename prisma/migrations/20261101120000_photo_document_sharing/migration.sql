-- AlterTable
ALTER TABLE `photo_document`
    ADD COLUMN `visibility` VARCHAR(10) NOT NULL DEFAULT 'private',
    ADD COLUMN `share_token` VARCHAR(64) NULL,
    ADD COLUMN `share_image_url` VARCHAR(500) NULL,
    ADD COLUMN `shared_at` DATETIME(3) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `photo_document_share_token_key` ON `photo_document`(`share_token`);
