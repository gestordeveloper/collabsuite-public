-- AlterTable
ALTER TABLE `whatsappcampaign` ADD COLUMN `group_jid` VARCHAR(100) NULL,
    ADD COLUMN `media_filename` VARCHAR(255) NULL,
    ADD COLUMN `media_type` VARCHAR(20) NULL,
    ADD COLUMN `media_url` VARCHAR(500) NULL,
    ADD COLUMN `task_id` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `whatsappcampaign_task_id_key` ON `whatsappcampaign`(`task_id`);

-- AddForeignKey
ALTER TABLE `whatsappcampaign` ADD CONSTRAINT `whatsappcampaign_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

