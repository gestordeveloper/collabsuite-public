-- AlterTable
ALTER TABLE `taskactivity`
    ADD COLUMN `attachment_url` VARCHAR(500) NULL,
    ADD COLUMN `attachment_name` VARCHAR(255) NULL,
    ADD COLUMN `attachment_type` VARCHAR(100) NULL,
    ADD COLUMN `attachment_size` INTEGER NULL;
