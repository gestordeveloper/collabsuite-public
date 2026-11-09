-- CreateTable
CREATE TABLE `social_app_config` (
    `platform` VARCHAR(10) NOT NULL,
    `client_id` VARCHAR(200) NOT NULL,
    `client_secret` TEXT NOT NULL,
    `public_url` VARCHAR(300) NULL,
    `updated_by` INTEGER NULL,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`platform`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `social_account` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `platform` VARCHAR(10) NOT NULL,
    `connected` BOOLEAN NOT NULL DEFAULT true,
    `external_id` VARCHAR(100) NOT NULL,
    `username` VARCHAR(150) NULL,
    `avatar` VARCHAR(1000) NULL,
    `access_token` TEXT NOT NULL,
    `refresh_token` TEXT NULL,
    `expires_at` DATETIME(3) NULL,
    `token_error` VARCHAR(300) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `social_account_user_id_idx`(`user_id`),
    UNIQUE INDEX `social_account_project_id_platform_key`(`project_id`, `platform`),
    UNIQUE INDEX `social_account_platform_external_id_key`(`platform`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `social_post` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `account_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `task_id` INTEGER NULL,
    `group_id` VARCHAR(40) NULL,
    `kind` VARCHAR(15) NOT NULL,
    `title` VARCHAR(255) NULL,
    `caption` TEXT NULL,
    `media` TEXT NOT NULL,
    `options` TEXT NULL,
    `status` VARCHAR(15) NOT NULL DEFAULT 'scheduled',
    `scheduled_at` DATETIME(3) NULL,
    `published_at` DATETIME(3) NULL,
    `external_id` VARCHAR(100) NULL,
    `permalink` VARCHAR(500) NULL,
    `note` VARCHAR(300) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `social_post_task_id_key`(`task_id`),
    INDEX `social_post_account_id_status_idx`(`account_id`, `status`),
    INDEX `social_post_user_id_status_idx`(`user_id`, `status`),
    INDEX `social_post_status_scheduled_at_idx`(`status`, `scheduled_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `social_account` ADD CONSTRAINT `social_account_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `social_account` ADD CONSTRAINT `social_account_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `social_post` ADD CONSTRAINT `social_post_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `social_account`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `social_post` ADD CONSTRAINT `social_post_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
