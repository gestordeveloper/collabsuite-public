-- CreateTable
CREATE TABLE `User` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL DEFAULT -1,
    `branch_id` INTEGER NULL,
    `telegram_id` VARCHAR(100) NULL,
    `photo` VARCHAR(500) NULL,
    `first_name` VARCHAR(100) NOT NULL DEFAULT '',
    `last_name` VARCHAR(100) NULL DEFAULT '',
    `username` VARCHAR(50) NULL,
    `biography` TEXT NULL,
    `document` VARCHAR(20) NULL,
    `datebirth` DATETIME(3) NULL,
    `genre` VARCHAR(10) NULL,
    `telephone` VARCHAR(20) NULL,
    `email` VARCHAR(150) NOT NULL DEFAULT '',
    `password` VARCHAR(255) NOT NULL DEFAULT '',
    `status` ENUM('registered', 'confirmed', 'active', 'inactive') NOT NULL DEFAULT 'inactive',
    `url` VARCHAR(500) NULL,
    `level` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `utm_source` VARCHAR(100) NULL,
    `utm_medium` VARCHAR(100) NULL,
    `utm_campaign` VARCHAR(100) NULL,
    `utm_term` VARCHAR(100) NULL,

    UNIQUE INDEX `User_username_key`(`username`),
    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_company_id_idx`(`company_id`),
    INDEX `User_email_idx`(`email`),
    INDEX `User_username_idx`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Funnel` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `funnel_default` INTEGER NULL DEFAULT 0,
    `name` VARCHAR(200) NULL,
    `content` TEXT NULL,
    `color` VARCHAR(7) NULL DEFAULT '#ec1889',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `Funnel_company_id_idx`(`company_id`),
    INDEX `Funnel_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FunnelStage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `funnel_id` INTEGER NULL,
    `name` VARCHAR(100) NULL,
    `status` VARCHAR(20) NULL,
    `stage_order` INTEGER NULL,
    `stage_done` BOOLEAN NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `FunnelStage_funnel_id_idx`(`funnel_id`),
    INDEX `FunnelStage_funnel_id_stage_order_idx`(`funnel_id`, `stage_order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FunnelUser` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `funnel_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `FunnelUser_funnel_id_idx`(`funnel_id`),
    INDEX `FunnelUser_user_id_idx`(`user_id`),
    UNIQUE INDEX `FunnelUser_funnel_id_user_id_key`(`funnel_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `funnel_id` INTEGER NULL DEFAULT 0,
    `stage_id` INTEGER NULL DEFAULT 0,
    `sort_order` INTEGER NULL DEFAULT 0,
    `user_id` INTEGER NULL,
    `task_id` INTEGER NULL DEFAULT 0,
    `sprint_id` INTEGER NULL,
    `meet_id` VARCHAR(100) NULL,
    `platform_company_id` INTEGER NULL,
    `platform_company_name` VARCHAR(200) NULL,
    `priority` ENUM('low', 'medium', 'high') NULL,
    `due_at` DATETIME(3) NULL,
    `end_at` DATETIME(3) NULL,
    `hour_at` VARCHAR(5) NULL,
    `estimated_time` VARCHAR(5) NULL,
    `story_points` INTEGER NULL,
    `title` VARCHAR(255) NULL,
    `slug` VARCHAR(255) NULL,
    `description` TEXT NULL,
    `content` TEXT NULL,
    `type` ENUM('task', 'meeting') NULL,
    `meet_uri` VARCHAR(500) NULL,
    `first_name` VARCHAR(100) NULL,
    `last_name` VARCHAR(100) NULL,
    `email` VARCHAR(150) NULL,
    `phone` VARCHAR(20) NULL,
    `group_id` VARCHAR(100) NULL,
    `icon` VARCHAR(100) NULL,
    `cover` VARCHAR(500) NULL,
    `status` ENUM('notdone', 'inprogress', 'done') NOT NULL DEFAULT 'notdone',
    `is_sprint` BOOLEAN NULL DEFAULT false,
    `is_called` BOOLEAN NULL DEFAULT false,
    `is_whatsapp` BOOLEAN NULL DEFAULT false,
    `started_at` DATETIME(3) NULL,
    `closed_at` DATETIME(3) NULL,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `Task_funnel_id_idx`(`funnel_id`),
    INDEX `Task_stage_id_idx`(`stage_id`),
    INDEX `Task_user_id_idx`(`user_id`),
    INDEX `Task_status_idx`(`status`),
    INDEX `Task_due_at_idx`(`due_at`),
    INDEX `Task_funnel_id_stage_id_sort_order_idx`(`funnel_id`, `stage_id`, `sort_order`),
    INDEX `Task_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskActivity` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `task_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `content` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `TaskActivity_task_id_created_at_idx`(`task_id`, `created_at`),
    INDEX `TaskActivity_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskChecklist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `is_done` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `TaskChecklist_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskRecurrence` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NOT NULL,
    `task_id` INTEGER NOT NULL,
    `frequency` ENUM('daily', 'weekly', 'monthly') NOT NULL,
    `interval_value` INTEGER NULL DEFAULT 1,
    `week_days` VARCHAR(20) NULL,
    `month_day` INTEGER NULL,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NULL,
    `next_run` DATETIME(3) NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `TaskRecurrence_task_id_idx`(`task_id`),
    INDEX `TaskRecurrence_next_run_idx`(`next_run`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskStageHistory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `funnel_id` INTEGER NOT NULL,
    `stage_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `TaskStageHistory_task_id_created_at_idx`(`task_id`, `created_at`),
    INDEX `TaskStageHistory_funnel_id_stage_id_idx`(`funnel_id`, `stage_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaskUser` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `task_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `TaskUser_task_id_idx`(`task_id`),
    INDEX `TaskUser_user_id_idx`(`user_id`),
    UNIQUE INDEX `TaskUser_task_id_user_id_key`(`task_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Funnel` ADD CONSTRAINT `Funnel_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FunnelStage` ADD CONSTRAINT `FunnelStage_funnel_id_fkey` FOREIGN KEY (`funnel_id`) REFERENCES `Funnel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FunnelUser` ADD CONSTRAINT `FunnelUser_funnel_id_fkey` FOREIGN KEY (`funnel_id`) REFERENCES `Funnel`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FunnelUser` ADD CONSTRAINT `FunnelUser_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_funnel_id_fkey` FOREIGN KEY (`funnel_id`) REFERENCES `Funnel`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_stage_id_fkey` FOREIGN KEY (`stage_id`) REFERENCES `FunnelStage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskActivity` ADD CONSTRAINT `TaskActivity_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskActivity` ADD CONSTRAINT `TaskActivity_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskChecklist` ADD CONSTRAINT `TaskChecklist_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskRecurrence` ADD CONSTRAINT `TaskRecurrence_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskStageHistory` ADD CONSTRAINT `TaskStageHistory_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskUser` ADD CONSTRAINT `TaskUser_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `Task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaskUser` ADD CONSTRAINT `TaskUser_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
