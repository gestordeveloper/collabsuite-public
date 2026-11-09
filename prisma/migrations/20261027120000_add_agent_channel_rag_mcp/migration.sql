-- AlterTable
ALTER TABLE `agent`
    ADD COLUMN `channel_connection_id` INTEGER NULL,
    ADD COLUMN `channel_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `rag_enabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `session_ttl_seconds` INTEGER NOT NULL DEFAULT 3600,
    ADD COLUMN `buffer_delay_seconds` INTEGER NOT NULL DEFAULT 5,
    ADD COLUMN `humanize_replies` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `handoff_enabled` BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX `agent_channel_connection_id_idx` ON `agent`(`channel_connection_id`);

-- AddForeignKey
ALTER TABLE `agent` ADD CONSTRAINT `agent_channel_connection_id_fkey` FOREIGN KEY (`channel_connection_id`) REFERENCES `whatsappconnection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `agent_knowledge_file` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `file_id` VARCHAR(20) NOT NULL,
    `filename` VARCHAR(255) NOT NULL,
    `chunks_count` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(20) NOT NULL DEFAULT 'processing',
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `agent_knowledge_file_agent_id_idx`(`agent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_mcp_server` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `type` VARCHAR(10) NOT NULL DEFAULT 'url',
    `url` TEXT NULL,
    `auth_token` TEXT NULL,
    `command` VARCHAR(255) NULL,
    `args` TEXT NULL,
    `env` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `agent_mcp_server_agent_id_name_key`(`agent_id`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agent_channel_session` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `agent_id` INTEGER NOT NULL,
    `contact_jid` VARCHAR(100) NOT NULL,
    `contact_name` VARCHAR(200) NULL,
    `history` LONGTEXT NOT NULL,
    `handed_off` BOOLEAN NOT NULL DEFAULT false,
    `expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `agent_channel_session_agent_id_contact_jid_key`(`agent_id`, `contact_jid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agent_knowledge_file` ADD CONSTRAINT `agent_knowledge_file_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `agent_mcp_server` ADD CONSTRAINT `agent_mcp_server_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `agent_channel_session` ADD CONSTRAINT `agent_channel_session_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agent`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
