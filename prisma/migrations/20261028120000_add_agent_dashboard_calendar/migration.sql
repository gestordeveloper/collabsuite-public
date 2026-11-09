-- CreateTable
CREATE TABLE `agent_calendar_access` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `can_write` BOOLEAN NOT NULL DEFAULT true,
    `enforce_availability` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `agent_calendar_access_agent_id_user_id_key`(`agent_id`, `user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_turn_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `channel` VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
    `contact_jid` VARCHAR(100) NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'ok',
    `error` TEXT NULL,
    `agent_ms` INTEGER NOT NULL DEFAULT 0,
    `wait_ms` INTEGER NULL,
    `input_tokens` INTEGER NOT NULL DEFAULT 0,
    `output_tokens` INTEGER NOT NULL DEFAULT 0,
    `tool_calls` INTEGER NOT NULL DEFAULT 0,
    `tools` TEXT NULL,
    `used_rag` BOOLEAN NOT NULL DEFAULT false,
    `media` VARCHAR(60) NULL,
    `messages_in` INTEGER NOT NULL DEFAULT 1,
    `handoff` BOOLEAN NOT NULL DEFAULT false,
    `handoff_reason` TEXT NULL,
    `ticket_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_turn_log_agent_id_created_at_idx`(`agent_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_appointment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `task_id` INTEGER NULL,
    `action` VARCHAR(12) NOT NULL,
    `channel` VARCHAR(20) NOT NULL DEFAULT 'whatsapp',
    `contact_name` VARCHAR(200) NULL,
    `contact_jid` VARCHAR(100) NULL,
    `starts_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_appointment_agent_id_created_at_idx`(`agent_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_calendar_access` ADD CONSTRAINT `agent_calendar_access_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `agent_calendar_access` ADD CONSTRAINT `agent_calendar_access_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `agent_turn_log` ADD CONSTRAINT `agent_turn_log_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `agent_appointment` ADD CONSTRAINT `agent_appointment_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
