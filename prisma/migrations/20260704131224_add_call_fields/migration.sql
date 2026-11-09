-- AlterTable
ALTER TABLE `task` ADD COLUMN `call_platform` VARCHAR(100) NULL,
    ADD COLUMN `call_reason` VARCHAR(255) NULL;
