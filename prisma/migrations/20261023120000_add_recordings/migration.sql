-- CreateTable
CREATE TABLE `recording` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `project_id` INTEGER NULL,
    `title` VARCHAR(255) NOT NULL,
    `category` VARCHAR(100) NULL,
    `tipo` VARCHAR(50) NOT NULL DEFAULT 'Reunião',
    `tags` TEXT NULL,
    `status` ENUM('uploaded', 'transcribing', 'analyzing', 'done', 'error') NOT NULL DEFAULT 'uploaded',
    `progress_label` VARCHAR(120) NULL,
    `error` VARCHAR(500) NULL,
    `storage` VARCHAR(10) NOT NULL DEFAULT 's3',
    `storage_key` VARCHAR(500) NOT NULL,
    `original_name` VARCHAR(255) NULL,
    `mime_type` VARCHAR(100) NULL,
    `size_bytes` BIGINT NULL,
    `duration_seconds` INTEGER NULL,
    `recorded_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `transcript` LONGTEXT NULL,
    `summary` TEXT NULL,
    `participants` TEXT NULL,
    `topics` TEXT NULL,
    `decisions` TEXT NULL,
    `risks` TEXT NULL,
    `next_steps` TEXT NULL,
    `analysis_md` LONGTEXT NULL,
    `ai_provider` VARCHAR(20) NULL,
    `ai_model` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recording_user_id_recorded_at_idx`(`user_id`, `recorded_at`),
    INDEX `recording_project_id_recorded_at_idx`(`project_id`, `recorded_at`),
    INDEX `recording_company_id_idx`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `recording_action` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `recording_id` INTEGER NOT NULL,
    `text` TEXT NOT NULL,
    `priority` VARCHAR(4) NOT NULL DEFAULT 'P2',
    `owner_name` VARCHAR(150) NULL,
    `due_text` VARCHAR(100) NULL,
    `status` VARCHAR(12) NOT NULL DEFAULT 'pending',
    `task_id` INTEGER NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `recording_action_recording_id_idx`(`recording_id`),
    INDEX `recording_action_task_id_idx`(`task_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `recording` ADD CONSTRAINT `recording_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recording` ADD CONSTRAINT `recording_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recording_action` ADD CONSTRAINT `recording_action_recording_id_fkey` FOREIGN KEY (`recording_id`) REFERENCES `recording`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `recording_action` ADD CONSTRAINT `recording_action_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
