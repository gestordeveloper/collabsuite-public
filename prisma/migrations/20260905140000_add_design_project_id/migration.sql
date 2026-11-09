-- AlterTable
ALTER TABLE `design` ADD COLUMN `project_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `design_project_id_idx` ON `design`(`project_id`);

-- AddForeignKey
ALTER TABLE `design` ADD CONSTRAINT `design_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
