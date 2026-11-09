-- CreateTable
CREATE TABLE `ai_provider_credential` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `user_id` INTEGER NULL,
    `provider` VARCHAR(20) NOT NULL,
    `api_key` TEXT NOT NULL,
    `label` VARCHAR(100) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `ai_provider_credential_company_id_provider_idx`(`company_id`, `provider`),
    INDEX `ai_provider_credential_user_id_provider_idx`(`user_id`, `provider`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `name` VARCHAR(150) NOT NULL,
    `description` TEXT NULL,
    `avatar_emoji` VARCHAR(10) NULL,
    `avatar_color` VARCHAR(7) NULL DEFAULT '#6366f1',
    `provider` VARCHAR(20) NOT NULL,
    `model` VARCHAR(100) NOT NULL,
    `system_prompt` LONGTEXT NOT NULL,
    `temperature` DOUBLE NULL DEFAULT 0.7,
    `max_tokens` INTEGER NULL DEFAULT 2048,
    `allowed_tools` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agent_user_id_idx`(`user_id`),
    INDEX `agent_company_id_idx`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_pipeline` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `description` TEXT NULL,
    `nodes` LONGTEXT NOT NULL,
    `edges` LONGTEXT NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `agent_pipeline_user_id_idx`(`user_id`),
    INDEX `agent_pipeline_company_id_idx`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_run` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `pipeline_id` INTEGER NULL,
    `agent_id` INTEGER NULL,
    `status` ENUM('pending', 'running', 'done', 'error', 'cancelled') NOT NULL DEFAULT 'pending',
    `input` LONGTEXT NULL,
    `output` LONGTEXT NULL,
    `error` VARCHAR(500) NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_run_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `agent_run_pipeline_id_idx`(`pipeline_id`),
    INDEX `agent_run_agent_id_idx`(`agent_id`),
    INDEX `agent_run_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_run_step` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `run_id` INTEGER NOT NULL,
    `node_id` VARCHAR(100) NULL,
    `agent_id` INTEGER NULL,
    `step_order` INTEGER NOT NULL DEFAULT 0,
    `status` ENUM('pending', 'running', 'done', 'error', 'cancelled') NOT NULL DEFAULT 'pending',
    `input` LONGTEXT NULL,
    `output` LONGTEXT NULL,
    `tool_calls` LONGTEXT NULL,
    `error` VARCHAR(500) NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_run_step_run_id_step_order_idx`(`run_id`, `step_order`),
    INDEX `agent_run_step_agent_id_idx`(`agent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ai_provider_credential` ADD CONSTRAINT `ai_provider_credential_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent` ADD CONSTRAINT `agent_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_pipeline` ADD CONSTRAINT `agent_pipeline_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_run` ADD CONSTRAINT `agent_run_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_run` ADD CONSTRAINT `agent_run_pipeline_id_fkey` FOREIGN KEY (`pipeline_id`) REFERENCES `agent_pipeline`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_run` ADD CONSTRAINT `agent_run_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_run_step` ADD CONSTRAINT `agent_run_step_run_id_fkey` FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agent_run_step` ADD CONSTRAINT `agent_run_step_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
