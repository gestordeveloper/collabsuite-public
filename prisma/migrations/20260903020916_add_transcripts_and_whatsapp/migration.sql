-- CreateTable
CREATE TABLE `tasktranscript` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `task_id` INTEGER NOT NULL,
    `attachment_id` INTEGER NULL,
    `status` ENUM('pending', 'processing', 'done', 'error') NOT NULL DEFAULT 'pending',
    `text` LONGTEXT NULL,
    `language` VARCHAR(10) NULL,
    `error` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `tasktranscript_task_id_idx`(`task_id`),
    INDEX `tasktranscript_attachment_id_idx`(`attachment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transcriptmessage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `transcript_id` INTEGER NOT NULL,
    `role` VARCHAR(20) NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `transcriptmessage_transcript_id_idx`(`transcript_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsappconnection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `phone_number` VARCHAR(30) NULL,
    `status` ENUM('disconnected', 'pairing', 'connected', 'error') NOT NULL DEFAULT 'disconnected',
    `auth_state` LONGTEXT NULL,
    `qr` TEXT NULL,
    `last_connected_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `whatsappconnection_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsappcontactlist` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `connection_id` INTEGER NULL,
    `name` VARCHAR(150) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `whatsappcontactlist_user_id_idx`(`user_id`),
    INDEX `whatsappcontactlist_connection_id_idx`(`connection_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsappcontact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `list_id` INTEGER NOT NULL,
    `name` VARCHAR(150) NULL,
    `phone` VARCHAR(30) NOT NULL,
    `tags` VARCHAR(255) NULL,
    `opted_out` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `whatsappcontact_list_id_idx`(`list_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsappcampaign` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `connection_id` INTEGER NOT NULL,
    `list_id` INTEGER NULL,
    `name` VARCHAR(150) NOT NULL,
    `message` TEXT NOT NULL,
    `status` ENUM('draft', 'scheduled', 'sending', 'paused', 'done', 'failed') NOT NULL DEFAULT 'draft',
    `scheduled_at` DATETIME(3) NULL,
    `min_delay_seconds` INTEGER NOT NULL DEFAULT 3,
    `max_delay_seconds` INTEGER NOT NULL DEFAULT 8,
    `daily_limit` INTEGER NULL DEFAULT 200,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `whatsappcampaign_user_id_idx`(`user_id`),
    INDEX `whatsappcampaign_connection_id_idx`(`connection_id`),
    INDEX `whatsappcampaign_list_id_idx`(`list_id`),
    INDEX `whatsappcampaign_status_scheduled_at_idx`(`status`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `whatsappcampaignrecipient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `campaign_id` INTEGER NOT NULL,
    `contact_id` INTEGER NULL,
    `phone` VARCHAR(30) NOT NULL,
    `name` VARCHAR(150) NULL,
    `status` ENUM('pending', 'sent', 'failed', 'skipped') NOT NULL DEFAULT 'pending',
    `sent_at` DATETIME(3) NULL,
    `error` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `whatsappcampaignrecipient_campaign_id_idx`(`campaign_id`),
    INDEX `whatsappcampaignrecipient_campaign_id_status_idx`(`campaign_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `tasktranscript` ADD CONSTRAINT `tasktranscript_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `task`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `tasktranscript` ADD CONSTRAINT `tasktranscript_attachment_id_fkey` FOREIGN KEY (`attachment_id`) REFERENCES `taskattachment`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transcriptmessage` ADD CONSTRAINT `transcriptmessage_transcript_id_fkey` FOREIGN KEY (`transcript_id`) REFERENCES `tasktranscript`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsappconnection` ADD CONSTRAINT `whatsappconnection_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsappcontactlist` ADD CONSTRAINT `whatsappcontactlist_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsappcontactlist` ADD CONSTRAINT `whatsappcontactlist_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `whatsappconnection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsappcontact` ADD CONSTRAINT `whatsappcontact_list_id_fkey` FOREIGN KEY (`list_id`) REFERENCES `whatsappcontactlist`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsappcampaign` ADD CONSTRAINT `whatsappcampaign_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsappcampaign` ADD CONSTRAINT `whatsappcampaign_connection_id_fkey` FOREIGN KEY (`connection_id`) REFERENCES `whatsappconnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsappcampaign` ADD CONSTRAINT `whatsappcampaign_list_id_fkey` FOREIGN KEY (`list_id`) REFERENCES `whatsappcontactlist`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `whatsappcampaignrecipient` ADD CONSTRAINT `whatsappcampaignrecipient_campaign_id_fkey` FOREIGN KEY (`campaign_id`) REFERENCES `whatsappcampaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

