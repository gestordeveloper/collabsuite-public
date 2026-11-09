-- AlterTable
ALTER TABLE `funnel` ADD COLUMN `drive_folder_id` VARCHAR(100) NULL,
    ADD COLUMN `drive_folder_link` TEXT NULL,
    ADD COLUMN `drive_owner_user_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `funnel_drive_owner_user_id_idx` ON `funnel`(`drive_owner_user_id`);

-- AddForeignKey
ALTER TABLE `funnel` ADD CONSTRAINT `funnel_drive_owner_user_id_fkey` FOREIGN KEY (`drive_owner_user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
