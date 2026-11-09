-- AddColumn: user.role
ALTER TABLE `user` ADD COLUMN `role` ENUM('user', 'admin', 'super_admin') NOT NULL DEFAULT 'user';

-- AddColumn: user.schedule_settings
ALTER TABLE `user` ADD COLUMN `schedule_settings` TEXT NULL;

-- CreateTable: taskattachment
CREATE TABLE IF NOT EXISTS `taskattachment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `file_url` VARCHAR(500) NOT NULL,
    `file_size` INTEGER NOT NULL DEFAULT 0,
    `file_type` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `taskattachment_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey: taskattachment -> task
ALTER TABLE `taskattachment` ADD CONSTRAINT `taskattachment_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;