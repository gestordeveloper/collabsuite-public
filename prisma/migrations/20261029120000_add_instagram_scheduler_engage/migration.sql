-- CreateTable
CREATE TABLE `instagram_account` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `ig_user_id` VARCHAR(40) NOT NULL,
    `username` VARCHAR(100) NULL,
    `avatar` VARCHAR(500) NULL,
    `page_name` VARCHAR(200) NULL,
    `page_token` TEXT NOT NULL,
    `user_token` TEXT NULL,
    `webhook_ok` BOOLEAN NOT NULL DEFAULT false,
    `token_error` VARCHAR(300) NULL,
    `refreshed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `instagram_account_user_id_key`(`user_id`),
    INDEX `instagram_account_ig_user_id_idx`(`ig_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `instagram_automation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'paused',
    `ig_media_id` VARCHAR(60) NULL,
    `post_image` VARCHAR(1000) NULL,
    `post_caption` TEXT NULL,
    `keywords` TEXT NULL,
    `reply_text` TEXT NULL,
    `ai_reply` BOOLEAN NOT NULL DEFAULT true,
    `dm_text` TEXT NULL,
    `cta_text` VARCHAR(40) NULL,
    `cta_link` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `instagram_automation_user_id_status_idx`(`user_id`, `status`),
    INDEX `instagram_automation_ig_media_id_idx`(`ig_media_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `instagram_post` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `task_id` INTEGER NULL,
    `title` VARCHAR(255) NULL,
    `caption` TEXT NULL,
    `media` TEXT NOT NULL,
    `status` VARCHAR(15) NOT NULL DEFAULT 'scheduled',
    `scheduled_at` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `ig_media_id` VARCHAR(60) NULL,
    `permalink` VARCHAR(500) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `automation_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `instagram_post_task_id_key`(`task_id`),
    INDEX `instagram_post_user_id_status_idx`(`user_id`, `status`),
    INDEX `instagram_post_status_scheduled_at_idx`(`status`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `instagram_engagement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `automation_id` INTEGER NOT NULL,
    `type` VARCHAR(10) NOT NULL,
    `comment_id` VARCHAR(60) NULL,
    `username` VARCHAR(100) NULL,
    `text` TEXT NULL,
    `error` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `instagram_engagement_automation_id_created_at_idx`(`automation_id`, `created_at`),
    UNIQUE INDEX `instagram_engagement_automation_id_comment_id_type_key`(`automation_id`, `comment_id`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `instagram_account` ADD CONSTRAINT `instagram_account_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `instagram_automation` ADD CONSTRAINT `instagram_automation_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `instagram_post` ADD CONSTRAINT `instagram_post_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `instagram_post` ADD CONSTRAINT `instagram_post_automation_id_fkey` FOREIGN KEY (`automation_id`) REFERENCES `instagram_automation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `instagram_engagement` ADD CONSTRAINT `instagram_engagement_automation_id_fkey` FOREIGN KEY (`automation_id`) REFERENCES `instagram_automation`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
