-- AlterTable
ALTER TABLE `projectuser` ADD COLUMN `external_user_id` VARCHAR(100) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `projectuser_project_id_external_user_id_key` ON `projectuser`(`project_id`, `external_user_id`);
