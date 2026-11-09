-- DropForeignKey
ALTER TABLE `funnel` DROP FOREIGN KEY `Funnel_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `funnelstage` DROP FOREIGN KEY `FunnelStage_funnel_id_fkey`;

-- DropForeignKey
ALTER TABLE `funneluser` DROP FOREIGN KEY `FunnelUser_funnel_id_fkey`;

-- DropForeignKey
ALTER TABLE `funneluser` DROP FOREIGN KEY `FunnelUser_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `task` DROP FOREIGN KEY `Task_funnel_id_fkey`;

-- DropForeignKey
ALTER TABLE `task` DROP FOREIGN KEY `Task_stage_id_fkey`;

-- DropForeignKey
ALTER TABLE `task` DROP FOREIGN KEY `Task_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `taskactivity` DROP FOREIGN KEY `TaskActivity_task_id_fkey`;

-- DropForeignKey
ALTER TABLE `taskactivity` DROP FOREIGN KEY `TaskActivity_user_id_fkey`;

-- DropForeignKey
ALTER TABLE `taskchecklist` DROP FOREIGN KEY `TaskChecklist_task_id_fkey`;

-- DropForeignKey
ALTER TABLE `taskrecurrence` DROP FOREIGN KEY `TaskRecurrence_task_id_fkey`;

-- DropForeignKey
ALTER TABLE `taskstagehistory` DROP FOREIGN KEY `TaskStageHistory_task_id_fkey`;

-- DropForeignKey
ALTER TABLE `taskuser` DROP FOREIGN KEY `TaskUser_task_id_fkey`;

-- DropForeignKey
ALTER TABLE `taskuser` DROP FOREIGN KEY `TaskUser_user_id_fkey`;

-- AlterTable
ALTER TABLE `task` ADD COLUMN `form_schema` LONGTEXT NULL,
    ADD COLUMN `template` VARCHAR(50) NULL DEFAULT 'default';

-- AlterTable
ALTER TABLE `taskattachment` MODIFY `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- CreateTable
CREATE TABLE `form_response` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `answers` LONGTEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `form_response_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `funnel` ADD CONSTRAINT `funnel_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `funnelstage` ADD CONSTRAINT `funnelstage_funnel_id_fkey` FOREIGN KEY (`funnel_id`) REFERENCES `funnel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `funneluser` ADD CONSTRAINT `funneluser_funnel_id_fkey` FOREIGN KEY (`funnel_id`) REFERENCES `funnel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `funneluser` ADD CONSTRAINT `funneluser_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task` ADD CONSTRAINT `task_funnel_id_fkey` FOREIGN KEY (`funnel_id`) REFERENCES `funnel`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task` ADD CONSTRAINT `task_stage_id_fkey` FOREIGN KEY (`stage_id`) REFERENCES `funnelstage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `task` ADD CONSTRAINT `task_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `taskactivity` ADD CONSTRAINT `taskactivity_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `taskactivity` ADD CONSTRAINT `taskactivity_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `taskchecklist` ADD CONSTRAINT `taskchecklist_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `taskrecurrence` ADD CONSTRAINT `taskrecurrence_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `taskstagehistory` ADD CONSTRAINT `taskstagehistory_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `taskuser` ADD CONSTRAINT `taskuser_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `taskuser` ADD CONSTRAINT `taskuser_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `form_response` ADD CONSTRAINT `form_response_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER TABLE `funnel` RENAME INDEX `Funnel_company_id_idx` TO `funnel_company_id_idx`;

-- RenameIndex
ALTER TABLE `funnel` RENAME INDEX `Funnel_user_id_idx` TO `funnel_user_id_idx`;

-- RenameIndex
ALTER TABLE `funnelstage` RENAME INDEX `FunnelStage_funnel_id_idx` TO `funnelstage_funnel_id_idx`;

-- RenameIndex
ALTER TABLE `funnelstage` RENAME INDEX `FunnelStage_funnel_id_stage_order_idx` TO `funnelstage_funnel_id_stage_order_idx`;

-- RenameIndex
ALTER TABLE `funneluser` RENAME INDEX `FunnelUser_funnel_id_idx` TO `funneluser_funnel_id_idx`;

-- RenameIndex
ALTER TABLE `funneluser` RENAME INDEX `FunnelUser_funnel_id_user_id_key` TO `funneluser_funnel_id_user_id_key`;

-- RenameIndex
ALTER TABLE `funneluser` RENAME INDEX `FunnelUser_user_id_idx` TO `funneluser_user_id_idx`;

-- RenameIndex
ALTER TABLE `task` RENAME INDEX `Task_deleted_at_idx` TO `task_deleted_at_idx`;

-- RenameIndex
ALTER TABLE `task` RENAME INDEX `Task_due_at_idx` TO `task_due_at_idx`;

-- RenameIndex
ALTER TABLE `task` RENAME INDEX `Task_funnel_id_idx` TO `task_funnel_id_idx`;

-- RenameIndex
ALTER TABLE `task` RENAME INDEX `Task_funnel_id_stage_id_sort_order_idx` TO `task_funnel_id_stage_id_sort_order_idx`;

-- RenameIndex
ALTER TABLE `task` RENAME INDEX `Task_stage_id_idx` TO `task_stage_id_idx`;

-- RenameIndex
ALTER TABLE `task` RENAME INDEX `Task_status_idx` TO `task_status_idx`;

-- RenameIndex
ALTER TABLE `task` RENAME INDEX `Task_user_id_idx` TO `task_user_id_idx`;

-- RenameIndex
ALTER TABLE `taskactivity` RENAME INDEX `TaskActivity_task_id_created_at_idx` TO `taskactivity_task_id_created_at_idx`;

-- RenameIndex
ALTER TABLE `taskactivity` RENAME INDEX `TaskActivity_user_id_idx` TO `taskactivity_user_id_idx`;

-- RenameIndex
ALTER TABLE `taskchecklist` RENAME INDEX `TaskChecklist_task_id_idx` TO `taskchecklist_task_id_idx`;

-- RenameIndex
ALTER TABLE `taskrecurrence` RENAME INDEX `TaskRecurrence_next_run_idx` TO `taskrecurrence_next_run_idx`;

-- RenameIndex
ALTER TABLE `taskrecurrence` RENAME INDEX `TaskRecurrence_task_id_idx` TO `taskrecurrence_task_id_idx`;

-- RenameIndex
ALTER TABLE `taskstagehistory` RENAME INDEX `TaskStageHistory_funnel_id_stage_id_idx` TO `taskstagehistory_funnel_id_stage_id_idx`;

-- RenameIndex
ALTER TABLE `taskstagehistory` RENAME INDEX `TaskStageHistory_task_id_created_at_idx` TO `taskstagehistory_task_id_created_at_idx`;

-- RenameIndex
ALTER TABLE `taskuser` RENAME INDEX `TaskUser_task_id_idx` TO `taskuser_task_id_idx`;

-- RenameIndex
ALTER TABLE `taskuser` RENAME INDEX `TaskUser_task_id_user_id_key` TO `taskuser_task_id_user_id_key`;

-- RenameIndex
ALTER TABLE `taskuser` RENAME INDEX `TaskUser_user_id_idx` TO `taskuser_user_id_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_company_id_idx` TO `user_company_id_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_email_idx` TO `user_email_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_email_key` TO `user_email_key`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_username_idx` TO `user_username_idx`;

-- RenameIndex
ALTER TABLE `user` RENAME INDEX `User_username_key` TO `user_username_key`;
