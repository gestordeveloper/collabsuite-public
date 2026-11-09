-- CreateTable
CREATE TABLE `ssh_connection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `host` VARCHAR(255) NOT NULL,
    `port` INTEGER NOT NULL DEFAULT 22,
    `username` VARCHAR(100) NOT NULL,
    `auth_type` VARCHAR(10) NOT NULL,
    `secret` TEXT NOT NULL,
    `passphrase` TEXT NULL,
    `host_fingerprint` VARCHAR(100) NULL,
    `record_sessions` BOOLEAN NOT NULL DEFAULT true,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_used_at` DATETIME(3) NULL,

    INDEX `ssh_connection_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ssh_session` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `connection_id` INTEGER NULL,
    `project_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `connection_name` VARCHAR(120) NOT NULL,
    `host` VARCHAR(255) NOT NULL,
    `username` VARCHAR(100) NOT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `ended_at` DATETIME(3) NULL,
    `end_reason` VARCHAR(40) NULL,
    `ip` VARCHAR(64) NULL,
    `user_agent` VARCHAR(300) NULL,
    `bytes_out` INTEGER NOT NULL DEFAULT 0,
    `recording_file` VARCHAR(120) NULL,
    `recording_truncated` BOOLEAN NOT NULL DEFAULT false,

    INDEX `ssh_session_project_id_started_at_idx`(`project_id`, `started_at`),
    INDEX `ssh_session_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ssh_command` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `command` TEXT NOT NULL,
    `description` VARCHAR(255) NULL,
    `confirm` BOOLEAN NOT NULL DEFAULT true,
    `created_by` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ssh_command_project_id_idx`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ssh_connection` ADD CONSTRAINT `ssh_connection_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ssh_session` ADD CONSTRAINT `ssh_session_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `ssh_connection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ssh_command` ADD CONSTRAINT `ssh_command_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
