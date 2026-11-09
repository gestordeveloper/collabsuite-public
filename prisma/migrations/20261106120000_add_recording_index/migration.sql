-- AlterTable
ALTER TABLE `recording` ADD COLUMN `indexed_at` DATETIME(3) NULL, ADD COLUMN `index_error` VARCHAR(300) NULL;

-- AlterTable
ALTER TABLE `agent` ADD COLUMN `recordings_enabled` BOOLEAN NOT NULL DEFAULT false;
