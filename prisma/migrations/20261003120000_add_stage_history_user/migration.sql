-- AlterTable
ALTER TABLE `taskstagehistory` ADD COLUMN `user_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `taskstagehistory_user_id_created_at_idx` ON `taskstagehistory`(`user_id`, `created_at`);

-- AddForeignKey
ALTER TABLE `taskstagehistory` ADD CONSTRAINT `taskstagehistory_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
