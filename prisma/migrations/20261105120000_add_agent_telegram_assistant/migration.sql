-- CreateTable
CREATE TABLE `agent_telegram` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `bot_token` TEXT NOT NULL,
    `bot_username` VARCHAR(100) NULL,
    `bot_name` VARCHAR(150) NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `briefing_enabled` BOOLEAN NOT NULL DEFAULT true,
    `briefing_time` VARCHAR(5) NOT NULL DEFAULT '08:00',
    `last_briefing_on` DATE NULL,
    `last_update_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `agent_telegram_agent_id_key`(`agent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_telegram_link` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `chat_id` VARCHAR(32) NOT NULL,
    `display_name` VARCHAR(200) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_telegram_link_user_id_idx`(`user_id`),
    UNIQUE INDEX `agent_telegram_link_agent_id_chat_id_key`(`agent_id`, `chat_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_telegram_pairing` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `code` VARCHAR(16) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `agent_telegram_pairing_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assistant_reminder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `chat_id` VARCHAR(32) NULL,
    `text` VARCHAR(500) NOT NULL,
    `remind_at` DATETIME(3) NOT NULL,
    `sent_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assistant_reminder_remind_at_sent_at_idx`(`remind_at`, `sent_at`),
    INDEX `assistant_reminder_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_telegram` ADD CONSTRAINT `agent_telegram_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `agent_telegram_link` ADD CONSTRAINT `agent_telegram_link_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `agent_telegram_pairing` ADD CONSTRAINT `agent_telegram_pairing_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `assistant_reminder` ADD CONSTRAINT `assistant_reminder_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
