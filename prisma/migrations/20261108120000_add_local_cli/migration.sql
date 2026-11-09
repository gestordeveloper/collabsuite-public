-- CreateTable
CREATE TABLE `local_cli` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `company_id` INTEGER NULL,
    `name` VARCHAR(80) NOT NULL,
    `preset` VARCHAR(20) NOT NULL,
    `command` VARCHAR(255) NOT NULL,
    `args` TEXT NOT NULL,
    `prompt_mode` VARCHAR(10) NOT NULL DEFAULT 'stdin',
    `models` TEXT NULL,
    `timeout_sec` INTEGER NOT NULL DEFAULT 300,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `local_cli_company_id_idx`(`company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
