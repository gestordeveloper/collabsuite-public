-- AlterTable
ALTER TABLE `task` ADD COLUMN `approved_at` DATETIME(3) NULL,
    ADD COLUMN `approved_by` VARCHAR(150) NULL;

-- AlterTable
ALTER TABLE `taskactivity` ADD COLUMN `is_client` BOOLEAN NOT NULL DEFAULT false;
